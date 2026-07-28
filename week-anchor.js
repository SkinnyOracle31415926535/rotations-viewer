(() => {
  'use strict';

  const scheduleId = document.body && document.body.dataset.scheduleId || 'spring_2026';
  const storageKey = `gymnastics-vault:week-anchor:v1:${scheduleId}`;
  const weekLength = 7 * 24 * 60 * 60 * 1000;

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

  const save = ({ date, rotation }) => {
    const record = normalize({ date, rotation, saved_at: new Date().toISOString() });
    if (!record) return null;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(record));
      return record;
    } catch (_error) {
      return null;
    }
  };

  const clear = () => {
    try {
      window.localStorage.removeItem(storageKey);
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
    read,
    save,
    clear,
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
