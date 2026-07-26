(() => {
  'use strict';

  const STORAGE_KEY = 'gymnastics-vault:alternate-schedule:v1';
  const SCHEMA_VERSION = 1;
  const CHANGE_EVENT = 'gymnastics-vault:alternate-schedule-change';

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

  const write = (records) => {
    const store = {
      schema_version: SCHEMA_VERSION,
      kind: 'browser_local_alternate_schedule',
      updated_at: new Date().toISOString(),
      records: records.map(normalizeRecord).filter(Boolean),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: store }));
    return store;
  };

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

  const save = (candidate) => {
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
    write(next);
    return normalized;
  };

  const remove = (id) => {
    const store = read();
    const next = store.records.filter((record) => record.id !== id);
    if (next.length === store.records.length) return false;
    write(next);
    return true;
  };

  const updateValidation = (id, staleReason) => {
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
    if (changed) write(next);
    return changed;
  };

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
    save,
    remove,
    updateValidation,
    staleReason,
    scopeLabel,
  });
})();
