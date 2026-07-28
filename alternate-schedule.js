(() => {
  'use strict';

  const STORAGE_KEY = 'gymnastics-vault:alternate-schedule:v1';
  const SCHEMA_VERSION = 1;
  const CHANGE_EVENT = 'gymnastics-vault:alternate-schedule-change';
  const AGGREGATE_LOCK = 'rotations-viewer:sync-local-aggregate-v1';

  const withAggregateLock = (task) => {
    if (!navigator.locks || typeof navigator.locks.request !== 'function') {
      return Promise.resolve().then(task);
    }
    return navigator.locks.request(AGGREGATE_LOCK, { mode: 'exclusive' }, task);
  };

  const text = (value, maximum = 180) =>
    typeof value === 'string' ? value.trim().slice(0, maximum) : '';

  const integer = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  };

  const validDate = (value) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';

  const normalizeRecord = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return null;
    const source = candidate.source_opening;
    const scope = candidate.scope;
    if (!source || typeof source !== 'object' || !scope || typeof scope !== 'object') return null;

    const start = integer(source.start_min);
    const end = integer(source.end_min);
    const sheet = text(candidate.source_sheet, 40);
    const equipment = text(source.equipment, 80);
    const className = text(candidate.class_name, 100);
    const id = text(candidate.id, 120);
    const key = text(source.key, 240);
    if (!id || !sheet || !equipment || !className || !key ||
        start === null || end === null || end <= start) {
      return null;
    }

    let normalizedScope = null;
    if (scope.type === 'date') {
      const date = validDate(scope.date);
      if (date) normalizedScope = { type: 'date', date };
    } else if (scope.type === 'recurring') {
      const weekday = text(scope.weekday, 10);
      const parity = text(scope.parity, 10);
      if (/^(Mon|Tues|Wed|Thurs|Fri|Sat)$/.test(weekday) && /^(Odd|Even)$/.test(parity)) {
        normalizedScope = { type: 'recurring', weekday, parity };
      }
    }
    if (!normalizedScope) return null;

    return {
      id,
      source_schedule_id: text(candidate.source_schedule_id, 80),
      source_fingerprint: text(candidate.source_fingerprint, 160),
      source_sheet: sheet,
      source_opening: {
        key,
        equipment,
        start_min: start,
        end_min: end,
        duration_min: Math.max(integer(source.duration_min) || end - start, 1),
      },
      class_name: className,
      scope: normalizedScope,
      created_at: text(candidate.created_at, 40),
      updated_at: text(candidate.updated_at, 40),
      stale_reason: text(candidate.stale_reason, 240),
      stale_at: text(candidate.stale_at, 40),
    };
  };

  const emptyStore = () => ({
    schema_version: SCHEMA_VERSION,
    kind: 'browser_local_alternate_schedule',
    updated_at: '',
    records: [],
  });

  const hasInvalidStoredData = () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !parsed || parsed.schema_version !== SCHEMA_VERSION ||
        !Array.isArray(parsed.records) ||
        parsed.records.some((record) => !normalizeRecord(record));
    } catch (_error) {
      return true;
    }
  };

  const assertStoredDataValid = () => {
    if (hasInvalidStoredData()) {
      throw new Error(
        'Local alternate schedule data needs a raw backup and review before it can be changed or synchronized.'
      );
    }
  };

  const read = () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schema_version !== SCHEMA_VERSION || !Array.isArray(parsed.records)) {
        return emptyStore();
      }
      return {
        schema_version: SCHEMA_VERSION,
        kind: 'browser_local_alternate_schedule',
        updated_at: text(parsed.updated_at, 40),
        records: parsed.records.map(normalizeRecord).filter(Boolean),
      };
    } catch (_error) {
      return emptyStore();
    }
  };

  const writeUnlocked = (records, {
    source = 'local',
    changedRecords = [],
    removedRecords = [],
  } = {}) => {
    assertStoredDataValid();
    const store = {
      schema_version: SCHEMA_VERSION,
      kind: 'browser_local_alternate_schedule',
      updated_at: new Date().toISOString(),
      records: records.map(normalizeRecord).filter(Boolean),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    const pending = [];
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        source,
        store,
        changedRecords: changedRecords.map(normalizeRecord).filter(Boolean),
        removedRecords: removedRecords.map(normalizeRecord).filter(Boolean),
        waitUntil(promise) {
          pending.push(Promise.resolve(promise));
        },
      },
    }));
    return { store, settled: Promise.all(pending) };
  };

  const syncValue = (candidate) => {
    const record = normalizeRecord(candidate);
    if (!record) return null;
    return {
      source_schedule_id: record.source_schedule_id ||
        String(window.GymScheduleVersion && window.GymScheduleVersion.schedule_id || ''),
      source_fingerprint: record.source_fingerprint ||
        String(window.GymScheduleVersion && window.GymScheduleVersion.source_fingerprint || ''),
      source_sheet: record.source_sheet,
      source_opening: { ...record.source_opening },
      class_name: record.class_name,
      scope: { ...record.scope },
    };
  };

  const identityText = (record) => JSON.stringify({
    opening_key: record.source_opening.key,
    class_name: record.class_name,
    scope: record.scope,
  });

  const sha256 = async (value) => {
    const digest = await window.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')).join('');
  };

  const toSyncRecord = async (candidate) => {
    const record = normalizeRecord(candidate);
    if (!record) throw new Error('The local alternate schedule entry is invalid.');
    return {
      recordId: `alternate:${await sha256(identityText(record))}`,
      value: syncValue(record),
    };
  };

  const listSyncRecords = () => withAggregateLock(async () => {
    assertStoredDataValid();
    const records = await Promise.all(read().records.map(toSyncRecord));
    const ids = new Set();
    for (const record of records) {
      if (ids.has(record.recordId)) {
        throw new Error('Duplicate local alternate schedules must be reviewed before sync.');
      }
      ids.add(record.recordId);
    }
    return records;
  });

  const exactKeys = (value, expected) =>
    value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\u001f') === expected.slice().sort().join('\u001f');

  const isSyncValue = (recordId, candidate) => {
    const value = normalizeRecord({ ...candidate, id: recordId });
    if (!value || !/^alternate:[a-f0-9]{64}$/.test(recordId) ||
        !exactKeys(candidate, [
          'source_schedule_id', 'source_fingerprint', 'source_sheet',
          'source_opening', 'class_name', 'scope',
        ]) ||
        !exactKeys(candidate.source_opening, [
          'key', 'equipment', 'start_min', 'end_min', 'duration_min',
        ])) {
      return false;
    }
    const scopeKeys = candidate.scope && candidate.scope.type === 'date'
      ? ['type', 'date']
      : ['type', 'weekday', 'parity'];
    if (!exactKeys(candidate.scope, scopeKeys)) return false;
    return JSON.stringify(syncValue(value)) === JSON.stringify({
      source_schedule_id: candidate.source_schedule_id,
      source_fingerprint: candidate.source_fingerprint,
      source_sheet: candidate.source_sheet,
      source_opening: {
        key: candidate.source_opening.key,
        equipment: candidate.source_opening.equipment,
        start_min: candidate.source_opening.start_min,
        end_min: candidate.source_opening.end_min,
        duration_min: candidate.source_opening.duration_min,
      },
      class_name: candidate.class_name,
      scope: candidate.scope.type === 'date'
        ? { type: candidate.scope.type, date: candidate.scope.date }
        : {
            type: candidate.scope.type,
            weekday: candidate.scope.weekday,
            parity: candidate.scope.parity,
          },
    });
  };

  const applySync = (recordId, candidate, deleted = false) => withAggregateLock(async () => {
    assertStoredDataValid();
    const store = read();
    const identified = await Promise.all(store.records.map(async (record) => ({
      record,
      sync: await toSyncRecord(record),
    })));
    const matches = identified.filter((item) => item.sync.recordId === recordId);
    if (matches.length > 1) {
      throw new Error('Duplicate local alternate schedules must be reviewed before sync.');
    }
    const existing = matches[0]?.record || null;
    if (deleted) {
      if (!existing) return true;
      writeUnlocked(
        store.records.filter((record) => record.id !== existing.id),
        { source: 'sync', removedRecords: [existing] },
      );
      return true;
    }
    if (!isSyncValue(recordId, candidate)) {
      throw new Error('The synchronized alternate schedule entry is invalid.');
    }
    const identifiedIncoming = await toSyncRecord({ ...candidate, id: recordId });
    if (identifiedIncoming.recordId !== recordId) {
      throw new Error('The synchronized alternate schedule identity does not match its contents.');
    }
    if (existing && JSON.stringify(syncValue(existing)) === JSON.stringify(candidate)) return true;
    const incoming = normalizeRecord({
      ...candidate,
      id: existing?.id || recordId,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stale_reason: '',
      stale_at: '',
    });
    if (!incoming) throw new Error('The synchronized alternate schedule entry is invalid.');
    writeUnlocked(
      [...store.records.filter((record) => record.id !== existing?.id), incoming],
      { source: 'sync', changedRecords: [incoming] },
    );
    return true;
  });

  const makeId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `alternate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const sameScope = (left, right) => left.type === right.type &&
    (left.type === 'date'
      ? left.date === right.date
      : left.weekday === right.weekday && left.parity === right.parity);

  const save = async (candidate) => {
    const result = await withAggregateLock(() => {
      assertStoredDataValid();
      const now = new Date().toISOString();
      let normalized = normalizeRecord({
        ...candidate,
        id: candidate.id || makeId(),
        created_at: candidate.created_at || now,
        updated_at: now,
      });
      if (!normalized) throw new Error('The alternate schedule entry is incomplete.');

      const store = read();
      const duplicate = store.records.find((record) =>
        record.id !== normalized.id &&
        record.source_opening.key === normalized.source_opening.key &&
        record.class_name === normalized.class_name &&
        sameScope(record.scope, normalized.scope)
      );
      if (duplicate) {
        normalized = {
          ...normalized,
          id: duplicate.id,
          created_at: duplicate.created_at || normalized.created_at,
        };
      }
      const next = store.records.filter((record) => record.id !== normalized.id);
      next.push(normalized);
      return {
        normalized,
        committed: writeUnlocked(
          next,
          { source: 'local', changedRecords: [normalized] },
        ),
      };
    });
    try {
      await result.committed.settled;
    } catch (error) {
      if (error && typeof error === 'object') error.localSaved = true;
      throw error;
    }
    return result.normalized;
  };

  const remove = async (id) => {
    const committed = await withAggregateLock(() => {
      assertStoredDataValid();
      const store = read();
      const next = store.records.filter((record) => record.id !== id);
      if (next.length === store.records.length) return null;
      const removed = store.records.filter((record) => record.id === id);
      return writeUnlocked(next, { source: 'local', removedRecords: removed });
    });
    if (!committed) return false;
    try {
      await committed.settled;
    } catch (error) {
      if (error && typeof error === 'object') error.localSaved = true;
      throw error;
    }
    return true;
  };

  const updateValidation = (id, staleReason) => withAggregateLock(() => {
    if (hasInvalidStoredData()) return false;
    const store = read();
    let changed = false;
    const now = new Date().toISOString();
    const next = store.records.map((record) => {
      if (record.id !== id) return record;
      const reason = text(staleReason, 240);
      if (record.stale_reason === reason) return record;
      changed = true;
      return {
        ...record,
        stale_reason: reason,
        stale_at: reason ? now : '',
        updated_at: now,
      };
    });
    if (changed) {
      writeUnlocked(next, {
        source: 'validation',
        changedRecords: next.filter((record) => record.id === id),
      });
    }
    return changed;
  });

  const staleReason = (record, scheduleVersion = window.GymScheduleVersion) => {
    if (record.stale_reason) return record.stale_reason;
    if (!scheduleVersion) return 'The published schedule version is unavailable for validation.';
    if (record.source_schedule_id !== scheduleVersion.schedule_id ||
        record.source_fingerprint !== scheduleVersion.source_fingerprint) {
      return `Saved from ${record.source_schedule_id || 'an older schedule'} and needs review against ${scheduleVersion.label || scheduleVersion.schedule_id}.`;
    }
    return '';
  };

  const scopeLabel = (scope) => scope.type === 'date'
    ? `Only ${scope.date}`
    : `Every ${scope.weekday}-${scope.parity}`;

  window.GymAlternateSchedule = Object.freeze({
    storageKey: STORAGE_KEY,
    changeEvent: CHANGE_EVENT,
    read,
    syncValue,
    toSyncRecord,
    listSyncRecords,
    isSyncValue,
    applySync,
    save,
    remove,
    updateValidation,
    staleReason,
    scopeLabel,
  });
})();
