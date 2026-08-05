(() => {
  'use strict';

  const scheduleId = document.body && document.body.dataset.scheduleId || 'winter_2026';
  const storageKey = `gymnastics-vault:week-anchor:v1:${scheduleId}`;
  const weekLength = 7 * 24 * 60 * 60 * 1000;
  const syncRecordId = `anchor:${scheduleId}`;
  const aggregateLock = 'rotations-viewer:sync-local-aggregate-v1';
  let fallbackLock = Promise.resolve();
  let mutationFence = 0;

  const withAggregateLock = task => {
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request(aggregateLock, { mode: 'exclusive' }, task);
    }
    const run = fallbackLock.then(task, task);
    fallbackLock = run.catch(() => {});
    return run;
  };

  const dateText = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const dateFromText = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || dateText(date) !== value ? null : date;
  };

  const mondayFor = (date) => {
    const monday = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()
    ));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday;
  };

  const normalize = (candidate) => {
    if (!candidate || !['Odd', 'Even'].includes(candidate.rotation)) return null;
    const date = dateFromText(candidate.date);
    if (!date) return null;
    return {
      date: dateText(date),
      week_start: dateText(mondayFor(date)),
      rotation: candidate.rotation,
      saved_at: typeof candidate.saved_at === 'string' ? candidate.saved_at : '',
    };
  };

  const read = () => {
    try {
      return normalize(JSON.parse(window.localStorage.getItem(storageKey) || 'null'));
    } catch (_error) {
      return null;
    }
  };

  const exactKeys = (value, expected) => (
    value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\u001f') === expected.slice().sort().join('\u001f')
  );

  const syncValue = candidate => {
    const normalized = normalize(candidate);
    return normalized ? {
      date: normalized.date,
      week_start: normalized.week_start,
      rotation: normalized.rotation,
      saved_at: normalized.saved_at,
    } : null;
  };

  const isSyncValue = (recordId, candidate) => (
    recordId === syncRecordId
    && exactKeys(candidate, ['date', 'week_start', 'rotation', 'saved_at'])
    && Boolean(syncValue(candidate))
    && JSON.stringify(syncValue(candidate)) === JSON.stringify(candidate)
  );

  const readStrict = () => {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return null;
    try {
      const value = syncValue(JSON.parse(raw));
      if (!value) throw new Error('The local week anchor needs a raw backup and review.');
      return value;
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error('The local week anchor needs a raw backup and review.');
    }
  };

  const listSyncRecords = () => withAggregateLock(() => {
    const value = readStrict();
    return value ? [{ recordId: syncRecordId, value }] : [];
  });

  const verifyCurrent = (recordId, value, { deleted = false } = {}) => withAggregateLock(() => {
    const current = readStrict();
    if (recordId !== syncRecordId
      || (deleted ? Boolean(current) : !current || JSON.stringify(current) !== JSON.stringify(value))) {
      throw new Error('A newer local week-anchor edit was preserved.');
    }
  });

  const applySync = (recordId, value, { deleted = false } = {}) => withAggregateLock(() => {
    if (recordId !== syncRecordId || (!deleted && !isSyncValue(recordId, value))) {
      throw new Error('The synchronized week anchor is invalid.');
    }
    const capturedFence = mutationFence;
    const previousRaw = window.localStorage.getItem(storageKey);
    if (deleted) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(value));
    if (mutationFence !== capturedFence) {
      if (previousRaw === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, previousRaw);
      throw new Error('A newer local week-anchor edit was preserved.');
    }
    const expected = deleted ? null : JSON.stringify(value);
    if (window.localStorage.getItem(storageKey) !== expected) {
      throw new Error('The synchronized week anchor could not be verified.');
    }
  });

  const save = ({ date, rotation }) => {
    const record = normalize({ date, rotation, saved_at: new Date().toISOString() });
    if (!record) return null;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(record));
      mutationFence += 1;
      return record;
    } catch (_error) {
      return null;
    }
  };

  const clear = () => {
    try {
      window.localStorage.removeItem(storageKey);
      mutationFence += 1;
      return true;
    } catch (_error) {
      return false;
    }
  };

  const rotationForDate = (date) => {
    const anchor = read();
    if (!anchor || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const anchorMonday = dateFromText(anchor.week_start);
    if (!anchorMonday) return null;
    const weeksApart = Math.round((mondayFor(date).getTime() - anchorMonday.getTime()) / weekLength);
    return {
      anchor,
      rotation: weeksApart % 2 === 0 ? anchor.rotation : anchor.rotation === 'Odd' ? 'Even' : 'Odd',
    };
  };

  const todayInTimezone = (timeZone) => {
    try {
      const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date()).map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    } catch (_error) {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
  };

  window.GymWeekAnchor = Object.freeze({
    storageKey,
    syncRecordId,
    read,
    save,
    clear,
    syncValue,
    isSyncValue,
    listSyncRecords,
    verifyCurrent,
    applySync,
    rotationForDate,
    todayInTimezone,
  });

  const initializeControls = () => {
    const dialog = document.querySelector('[data-week-anchor-dialog]');
    const openButton = document.querySelector('[data-week-anchor-open]');
    if (!dialog || !openButton || typeof dialog.showModal !== 'function') return;

    const form = dialog.querySelector('[data-week-anchor-form]');
    const dateInput = dialog.querySelector('[data-week-anchor-date]');
    const status = dialog.querySelector('[data-week-anchor-status]');
    const saveButton = dialog.querySelector('[data-week-anchor-save]');
    const clearButton = dialog.querySelector('[data-week-anchor-clear]');
    const closeButtons = Array.from(dialog.querySelectorAll('[data-week-anchor-close]'));
    if (!form || !dateInput || !saveButton) return;

    const selectedRotation = () => {
      const selected = form.querySelector('input[name="week-anchor-rotation"]:checked');
      return selected ? selected.value : 'Odd';
    };

    const setStatus = (message) => {
      if (status) status.textContent = message;
    };

    const populate = () => {
      const anchor = read();
      dateInput.value = anchor ? anchor.date : todayInTimezone('America/Los_Angeles');
      const input = form.querySelector(`input[name="week-anchor-rotation"][value="${anchor ? anchor.rotation : 'Odd'}"]`);
      if (input) input.checked = true;
      setStatus(anchor
        ? `Saved: the week of ${anchor.week_start} is ${anchor.rotation}.`
        : 'No saved anchor. The monthly default is currently in use.');
    };

    openButton.addEventListener('click', () => {
      populate();
      if (!dialog.open) dialog.showModal();
    });

    closeButtons.forEach((button) => button.addEventListener('click', () => {
      if (dialog.open) dialog.close();
    }));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const anchor = save({ date: dateInput.value, rotation: selectedRotation() });
      if (!anchor) {
        setStatus('Choose a valid date and week type.');
        dateInput.focus();
        return;
      }
      window.location.reload();
    });

    saveButton.addEventListener('click', () => {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    });

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        if (!clear()) {
          setStatus('This browser could not clear the saved anchor.');
          return;
        }
        window.location.reload();
      });
    }
  };

  initializeControls();
})();
