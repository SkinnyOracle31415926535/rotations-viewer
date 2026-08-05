(() => {
  'use strict';

  const scheduleId = document.body && document.body.dataset.scheduleId || 'winter_2026';
  const storageKey = `gymnastics-vault:collision-audit:v1:${scheduleId}`;
  const changeEvent = 'gymnastics-vault:collision-audit-change';
  const aggregateLock = 'rotations-viewer:sync-local-aggregate-v1';
  const allowedStatuses = new Set(['', 'needs_review', 'needs_fix', 'resolved']);
  let lastSettlement = Promise.resolve();

  const withAggregateLock = (task) => {
    if (!navigator.locks || typeof navigator.locks.request !== 'function') {
      return Promise.resolve().then(task);
    }
    return navigator.locks.request(aggregateLock, { mode: 'exclusive' }, task);
  };

  const plainObject = (value) =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

  const exactKeys = (value, expected) =>
    plainObject(value) &&
    Object.keys(value).sort().join('\u001f') === expected.slice().sort().join('\u001f');

  const boundedText = (value, maximum) =>
    typeof value === 'string' && value.length <= maximum ? value : null;

  const minute = (value) =>
    value === null || (Number.isInteger(value) && value >= 0 && value <= 24 * 60)
      ? value
      : undefined;

  const emptyStore = () => ({
    schema_version: 1,
    schedule_id: scheduleId,
    updated_at: '',
    records: {},
  });

  const normalizeLocalRecord = (recordId, candidate) => {
    const expectedKeys = [
      'schedule_id', 'collision_key', 'collision_id', 'collision_anchor',
      'sheet', 'equipment', 'start_min', 'end_min', 'summary',
      'audit_status', 'notes', 'updated_at',
    ];
    if (Object.prototype.hasOwnProperty.call(candidate || {}, 'source_fingerprint')) {
      expectedKeys.push('source_fingerprint');
    }
    if (!exactKeys(candidate, expectedKeys)) {
      return null;
    }
    const collisionKey = boundedText(candidate.collision_key, 180);
    const start = minute(candidate.start_min);
    const end = minute(candidate.end_min);
    if (candidate.schedule_id !== scheduleId || !collisionKey ||
        recordId !== `${scheduleId}:${collisionKey}` ||
        !allowedStatuses.has(candidate.audit_status) ||
        start === undefined || end === undefined ||
        (start !== null && end !== null && end < start)) {
      return null;
    }
    const fields = {
      collision_id: 100,
      collision_anchor: 180,
      sheet: 40,
      equipment: 100,
      summary: 600,
      notes: 4000,
      updated_at: 40,
    };
    const text = {};
    for (const [key, maximum] of Object.entries(fields)) {
      text[key] = boundedText(candidate[key], maximum);
      if (text[key] === null) return null;
    }
    return {
      schedule_id: scheduleId,
      collision_key: collisionKey,
      collision_id: text.collision_id,
      collision_anchor: text.collision_anchor,
      sheet: text.sheet,
      equipment: text.equipment,
      start_min: start,
      end_min: end,
      summary: text.summary,
      audit_status: candidate.audit_status,
      notes: text.notes,
      updated_at: text.updated_at,
      source_fingerprint: boundedText(candidate.source_fingerprint || '', 200) ?? '',
    };
  };

  const toRemoteRecordId = (localRecordId) => {
    const prefix = `${scheduleId}:`;
    if (typeof localRecordId !== 'string' || !localRecordId.startsWith(prefix)) return '';
    const recordId = `audit:${scheduleId}:${localRecordId.slice(prefix.length)}`;
    return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(recordId) ? recordId : '';
  };

  const syncValue = (localRecordId, candidate) => {
    const local = normalizeLocalRecord(localRecordId, candidate);
    if (!local) return null;
    return {
      schedule_id: scheduleId,
      source_fingerprint: local.source_fingerprint ||
        String(window.GymScheduleVersion && window.GymScheduleVersion.source_fingerprint || ''),
      collision_key: local.collision_key,
      audit_status: local.audit_status,
      notes: local.notes,
      edited_at: local.updated_at,
    };
  };

  const toSyncRecord = (localRecordId, candidate) => {
    const recordId = toRemoteRecordId(localRecordId);
    const value = syncValue(localRecordId, candidate);
    if (!recordId || !value) {
      throw new Error(`Collision audit ${localRecordId} is invalid.`);
    }
    return { recordId, value };
  };

  const read = () => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!plainObject(parsed) || parsed.schema_version !== 1 ||
        parsed.schedule_id !== scheduleId || !plainObject(parsed.records)) {
      throw new Error('The local collision audit has an invalid format.');
    }
    for (const [recordId, record] of Object.entries(parsed.records)) {
      if (!normalizeLocalRecord(recordId, record)) {
        throw new Error(`Local collision audit ${recordId} needs a raw backup and review.`);
      }
    }
    return {
      schema_version: 1,
      schedule_id: scheduleId,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
      records: { ...parsed.records },
    };
  };

  const writeUnlocked = (candidate, {
    source = 'local',
    changedIds = [],
    removedIds = [],
  } = {}) => {
    if (!plainObject(candidate) || !plainObject(candidate.records)) {
      throw new Error('The local collision audit has an invalid format.');
    }
    read();
    for (const [recordId, record] of Object.entries(candidate.records)) {
      if (!normalizeLocalRecord(recordId, record)) {
        throw new Error(`Local collision audit ${recordId} needs a raw backup and review.`);
      }
    }
    const store = {
      schema_version: 1,
      schedule_id: scheduleId,
      updated_at: new Date().toISOString(),
      records: { ...candidate.records },
    };
    window.localStorage.setItem(storageKey, JSON.stringify(store));
    const pending = [];
    window.dispatchEvent(new CustomEvent(changeEvent, {
      detail: {
        source,
        store,
        changedIds: changedIds.slice(),
        removedIds: removedIds.slice(),
        waitUntil(promise) {
          pending.push(Promise.resolve(promise));
        },
      },
    }));
    lastSettlement = Promise.all(pending);
    return { store, settled: lastSettlement };
  };

  const settleLocalCommit = async (committed) => {
    try {
      await committed.settled;
    } catch (error) {
      const caught = error instanceof Error
        ? error
        : new Error('The collision audit was saved locally, but sync could not queue it.');
      caught.localSaved = true;
      caught.localStore = committed.store;
      throw caught;
    }
    return committed.store;
  };

  const saveRecord = async (recordId, candidate) => {
    const committed = await withAggregateLock(() => {
      const store = read();
      const normalized = normalizeLocalRecord(recordId, candidate);
      if (!normalized) throw new Error(`Local collision audit ${recordId} is invalid.`);
      store.records[recordId] = normalized;
      return writeUnlocked(store, {
        source: 'local',
        changedIds: [recordId],
      });
    });
    return settleLocalCommit(committed);
  };

  const removeRecord = async (recordId) => {
    const result = await withAggregateLock(() => {
      const store = read();
      if (!Object.prototype.hasOwnProperty.call(store.records, recordId)) {
        return { committed: null, store };
      }
      delete store.records[recordId];
      return {
        committed: writeUnlocked(store, {
          source: 'local',
          removedIds: [recordId],
        }),
        store,
      };
    });
    if (!result.committed) return result.store;
    return settleLocalCommit(result.committed);
  };

  const isSyncValue = (recordId, candidate) => {
    if (!exactKeys(candidate, [
      'schedule_id', 'source_fingerprint', 'collision_key',
      'audit_status', 'notes', 'edited_at',
    ]) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(recordId || '') ||
        candidate.schedule_id !== scheduleId ||
        recordId !== `audit:${scheduleId}:${candidate.collision_key}` ||
        !allowedStatuses.has(candidate.audit_status) ||
        boundedText(candidate.source_fingerprint, 200) === null ||
        boundedText(candidate.collision_key, 180) === null ||
        !candidate.collision_key ||
        boundedText(candidate.notes, 4000) === null ||
        boundedText(candidate.edited_at, 40) === null) {
      return false;
    }
    return true;
  };

  const listSyncRecords = () => withAggregateLock(() => {
    const store = read();
    return Object.entries(store.records).map(([recordId, candidate]) =>
      toSyncRecord(recordId, candidate));
  });

  const verifyCurrent = (recordId, candidate, { deleted = false } = {}) => withAggregateLock(() => {
    const store = read();
    const prefix = `audit:${scheduleId}:`;
    if (typeof recordId !== 'string' || !recordId.startsWith(prefix)) {
      throw new Error('A staged collision-audit identifier was rejected.');
    }
    const localRecordId = `${scheduleId}:${recordId.slice(prefix.length)}`;
    const existing = Object.prototype.hasOwnProperty.call(store.records, localRecordId)
      ? toSyncRecord(localRecordId, store.records[localRecordId]).value
      : null;
    if (deleted ? existing !== null : existing === null || JSON.stringify(existing) !== JSON.stringify(candidate)) {
      throw new Error('A newer local collision-audit edit was preserved.');
    }
  });

  const applySync = (recordId, candidate, deleted = false) => withAggregateLock(() => {
    const store = read();
    const remotePrefix = `audit:${scheduleId}:`;
    if (typeof recordId !== 'string' || !recordId.startsWith(remotePrefix)) {
      throw new Error('The synchronized collision audit ID is invalid.');
    }
    const collisionKey = recordId.slice(remotePrefix.length);
    const localRecordId = `${scheduleId}:${collisionKey}`;
    if (deleted) {
      if (!Object.prototype.hasOwnProperty.call(store.records, localRecordId)) return true;
      delete store.records[localRecordId];
      writeUnlocked(store, { source: 'sync', removedIds: [localRecordId] });
      return true;
    }
    if (!isSyncValue(recordId, candidate) || candidate.collision_key !== collisionKey) {
      throw new Error('The synchronized collision audit is invalid.');
    }
    const existing = store.records[localRecordId] || {};
    if (JSON.stringify(syncValue(localRecordId, existing)) === JSON.stringify(candidate)) return true;
    store.records[localRecordId] = {
      schedule_id: scheduleId,
      collision_key: collisionKey,
      collision_id: typeof existing.collision_id === 'string' ? existing.collision_id : '',
      collision_anchor: typeof existing.collision_anchor === 'string' ? existing.collision_anchor : '',
      sheet: typeof existing.sheet === 'string' ? existing.sheet : '',
      equipment: typeof existing.equipment === 'string' ? existing.equipment : '',
      start_min: Number.isInteger(existing.start_min) ? existing.start_min : null,
      end_min: Number.isInteger(existing.end_min) ? existing.end_min : null,
      summary: typeof existing.summary === 'string' ? existing.summary : '',
      audit_status: candidate.audit_status,
      notes: candidate.notes,
      updated_at: candidate.edited_at,
      source_fingerprint: candidate.source_fingerprint,
    };
    writeUnlocked(store, { source: 'sync', changedIds: [localRecordId] });
    return true;
  });

  window.GymCollisionAudit = Object.freeze({
    scheduleId,
    storageKey,
    changeEvent,
    read,
    saveRecord,
    removeRecord,
    whenSettled: () => lastSettlement,
    syncValue,
    toSyncRecord,
    toRemoteRecordId,
    listSyncRecords,
    verifyCurrent,
    isSyncValue,
    applySync,
  });
})();
