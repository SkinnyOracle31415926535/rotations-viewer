(() => {
  'use strict';

  const api = window.GymAlternateSchedule;
  const scheduleVersion = window.GymScheduleVersion;
  const dialog = document.querySelector('[data-opening-modification-dialog]');
  if (!api || !scheduleVersion || !dialog) return;

  const form = dialog.querySelector('[data-opening-modification-form]');
  const selectionText = dialog.querySelector('[data-opening-modification-selection]');
  const classInput = dialog.querySelector('[data-opening-modification-class]');
  const dateInput = dialog.querySelector('[data-opening-modification-date]');
  const dateFields = dialog.querySelector('[data-opening-date-fields]');
  const recurringFields = dialog.querySelector('[data-opening-recurring-fields]');
  const recurringLabel = dialog.querySelector('[data-opening-recurring-label]');
  const error = dialog.querySelector('[data-opening-modification-error]');
  const saveButton = dialog.querySelector('[data-opening-modification-save]');
  const closeButtons = Array.from(dialog.querySelectorAll('[data-opening-modification-close]'));
  const toast = document.querySelector('[data-opening-modification-toast]');
  let selectedOpening = null;
  let toastTimer = null;

  const parseTime = (value) => {
    const match = /([0-9]{1,2}):([0-9]{2})\s*(AM|PM)/i.exec(value || '');
    if (!match) return null;
    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
    return (hour * 60) + Number(match[2]);
  };

  const formatTime = (minutes) => {
    const hour24 = Math.floor(minutes / 60);
    const minute = String(minutes % 60).padStart(2, '0');
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    return `${((hour24 + 11) % 12) + 1}:${minute}${suffix}`;
  };

  const dateText = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const sheetParts = (sheet) => {
    const match = /^(Mon|Tues|Wed|Thurs|Fri|Sat)-(Odd|Even)$/.exec(sheet || '');
    return match ? { weekday: match[1], parity: match[2] } : null;
  };

  const nextMatchingDate = (sheet) => {
    const parts = sheetParts(sheet);
    const weekdayNumbers = { Mon: 1, Tues: 2, Wed: 3, Thurs: 4, Fri: 5, Sat: 6 };
    const target = parts ? weekdayNumbers[parts.weekday] : null;
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    if (target !== null) {
      const difference = (target - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + difference);
    }
    return dateText(date);
  };

  const selectedScope = () => {
    const selected = form.querySelector('input[name="opening-modification-scope"]:checked');
    return selected ? selected.value : 'date';
  };

  const setScopeState = () => {
    const exactDate = selectedScope() === 'date';
    dateFields.hidden = !exactDate;
    recurringFields.hidden = exactDate;
    dateInput.required = exactDate;
  };

  const showToast = (message, href = '') => {
    if (!toast) return;
    toast.hidden = false;
    toast.replaceChildren();
    const copy = document.createElement('span');
    copy.textContent = message;
    toast.append(copy);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = 'View it on the schedule';
      toast.append(link);
    }
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 8000);
  };

  const searchFromHash = () => {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith('openings?')) return null;
    const params = new URLSearchParams(hash.slice('openings?'.length));
    const sheet = params.get('sheet') || '';
    const equipment = params.get('equipment') || '';
    const start = Number(params.get('start'));
    const end = Number(params.get('end'));
    const duration = Math.max(Number(params.get('duration')) || 1, 1);
    const className = (params.get('class_name') || '').trim();
    if (!sheet || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { sheet, equipment, start, end, duration, className };
  };

  const decorateOpenings = () => {
    document.querySelectorAll('.day-section[data-sheet]').forEach((section) => {
      const grid = section.querySelector('[data-opening-grid]');
      if (!grid) return;
      const headers = Array.from(grid.children).filter((child) => child.classList.contains('equip-head'));
      const tracks = Array.from(grid.children).filter((child) => child.classList.contains('equip-track'));
      tracks.forEach((track, index) => {
        const equipment = (headers[index] && headers[index].textContent || '').trim();
        track.dataset.openingEquipment = equipment;
        track.querySelectorAll('.open-block').forEach((block) => {
          const start = parseTime(block.querySelector('strong')?.textContent || block.title);
          const duration = Number.parseInt(block.querySelector('span')?.textContent || '', 10);
          if (!equipment || !Number.isFinite(start) || !Number.isFinite(duration) || duration < 1) return;
          const end = start + duration;
          const key = `${section.dataset.sheet}|${equipment}|${start}|${end}`;
          block.dataset.openingBlock = '';
          block.dataset.openingSheet = section.dataset.sheet;
          block.dataset.openingEquipment = equipment;
          block.dataset.openingStartMin = String(start);
          block.dataset.openingEndMin = String(end);
          block.dataset.openingDurationMin = String(duration);
          block.dataset.openingKey = key;
          block.tabIndex = 0;
          block.setAttribute('role', 'button');
          block.setAttribute(
            'aria-label',
            `${equipment} opening, ${formatTime(start)} to ${formatTime(end)}, ${duration} minutes. ` +
            'Double-click or press Enter to save a personal modified schedule card.'
          );
        });
      });
    });
  };

  const openingForBlock = (block) => ({
    sheet: block.dataset.openingSheet,
    equipment: block.dataset.openingEquipment,
    start: Number(block.dataset.openingStartMin),
    end: Number(block.dataset.openingEndMin),
    duration: Number(block.dataset.openingDurationMin),
    key: block.dataset.openingKey,
    block,
  });

  const openDialog = (opening) => {
    const parts = sheetParts(opening.sheet);
    if (!parts) return;
    selectedOpening = opening;
    error.hidden = true;
    error.textContent = '';
    selectionText.textContent =
      `${opening.sheet} · ${opening.equipment} · ${formatTime(opening.start)}–${formatTime(opening.end)} ` +
      `(${opening.duration} minutes)`;
    const search = searchFromHash();
    classInput.value = search && search.sheet === opening.sheet ? search.className : '';
    dateInput.value = nextMatchingDate(opening.sheet);
    recurringLabel.textContent = `Repeat every ${parts.weekday}-${parts.parity}.`;
    form.querySelector('input[name="opening-modification-scope"][value="date"]').checked = true;
    setScopeState();
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => classInput.focus(), 0);
  };

  const validateDate = (value, sheet) => {
    const parts = sheetParts(sheet);
    const weekdays = { Mon: 1, Tues: 2, Wed: 3, Thurs: 4, Fri: 5, Sat: 6 };
    const parsed = new Date(`${value}T12:00:00`);
    if (!parts || Number.isNaN(parsed.getTime())) return false;
    return parsed.getDay() === weekdays[parts.weekday];
  };

  const saveSelection = async () => {
    if (!selectedOpening) return;
    const className = classInput.value.trim();
    if (!className) {
      error.textContent = 'Enter the class that will use this opening.';
      error.hidden = false;
      classInput.focus();
      return;
    }
    const parts = sheetParts(selectedOpening.sheet);
    let scope;
    if (selectedScope() === 'date') {
      if (!dateInput.value || !validateDate(dateInput.value, selectedOpening.sheet)) {
        error.textContent = `Choose a ${parts.weekday} date for this ${selectedOpening.sheet} opening.`;
        error.hidden = false;
        dateInput.focus();
        return;
      }
      scope = { type: 'date', date: dateInput.value };
    } else {
      scope = { type: 'recurring', weekday: parts.weekday, parity: parts.parity };
    }

    try {
      await api.save({
        source_schedule_id: scheduleVersion.schedule_id,
        source_fingerprint: scheduleVersion.source_fingerprint,
        source_sheet: selectedOpening.sheet,
        source_opening: {
          key: selectedOpening.key,
          equipment: selectedOpening.equipment,
          start_min: selectedOpening.start,
          end_min: selectedOpening.end,
          duration_min: selectedOpening.duration,
        },
        class_name: className,
        scope,
      });
      selectedOpening.block.classList.add('is-opening-saved');
      dialog.close();
      showToast(
        'Personal card saved locally and queued for sync when connected. It did not change the published schedule.',
        `index.html#${selectedOpening.sheet.toLowerCase()}`
      );
    } catch (caught) {
      error.textContent = caught && caught.localSaved
        ? 'The modification was kept locally.'
        : caught && caught.message ||
          'The personal card could not be saved without risking existing local data.';
      error.hidden = false;
    }
  };

  const distanceToWindow = (block, start, end) => {
    const blockStart = Number(block.dataset.openingStartMin);
    const blockEnd = Number(block.dataset.openingEndMin);
    if (blockEnd > start && blockStart < end) return 0;
    return blockEnd <= start ? start - blockEnd : blockStart - end;
  };

  const focusOpenings = () => {
    const search = searchFromHash();
    if (!search) return;
    const section = Array.from(document.querySelectorAll('.day-section[data-sheet]'))
      .find((candidate) => candidate.dataset.sheet === search.sheet);
    if (!section) return;
    const allBlocks = Array.from(section.querySelectorAll('[data-opening-block]'));
    const qualified = allBlocks.filter((block) =>
      Number(block.dataset.openingDurationMin) >= search.duration
    );
    let matches = qualified.filter((block) => distanceToWindow(block, search.start, search.end) === 0);
    let nearby = false;
    if (!matches.length && qualified.length) {
      const nearest = Math.min(...qualified.map((block) => distanceToWindow(block, search.start, search.end)));
      matches = qualified.filter((block) => distanceToWindow(block, search.start, search.end) === nearest).slice(0, 12);
      nearby = true;
    }
    document.querySelectorAll('[data-opening-block]').forEach((block) => {
      block.classList.remove('is-opening-match', 'is-opening-nearby');
    });
    matches.forEach((block) => block.classList.add(nearby ? 'is-opening-nearby' : 'is-opening-match'));
    section.querySelectorAll('[data-opening-equipment]').forEach((track) => {
      if (!track.classList.contains('open-block')) {
        track.classList.toggle('is-opening-equipment-focus', track.dataset.openingEquipment === search.equipment);
      }
    });
    let notice = section.querySelector('[data-opening-search-notice]');
    if (!notice) {
      notice = document.createElement('p');
      notice.className = 'opening-search-notice';
      notice.dataset.openingSearchNotice = '';
      const head = section.querySelector('.section-head');
      if (head) head.insertAdjacentElement('afterend', notice);
    }
    if (notice) {
      notice.textContent = nearby
        ? `No opening overlaps ${formatTime(search.start)}–${formatTime(search.end)}. Showing the nearest options long enough for ${search.className || 'the class'}. Double-click one to save it.`
        : `${matches.length} opening${matches.length === 1 ? '' : 's'} fit ${formatTime(search.start)}–${formatTime(search.end)} for ${search.className || 'the class'}. Double-click one to save it.`;
    }
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const validateSavedOpenings = () => {
    const availableKeys = new Set(Array.from(document.querySelectorAll('[data-opening-key]'))
      .map((block) => block.dataset.openingKey));
    api.read().records.forEach((record) => {
      if (record.source_schedule_id !== scheduleVersion.schedule_id ||
          record.source_fingerprint !== scheduleVersion.source_fingerprint) return;
      const missing = !availableKeys.has(record.source_opening.key);
      void api.updateValidation(
        record.id,
        missing ? 'The saved opening is no longer available in this published schedule.' : ''
      ).catch(() => {});
    });
  };

  decorateOpenings();
  validateSavedOpenings();
  document.querySelectorAll('[data-opening-block]').forEach((block) => {
    block.addEventListener('click', () => {
      document.querySelectorAll('.open-block.is-opening-selected')
        .forEach((candidate) => candidate.classList.remove('is-opening-selected'));
      block.classList.add('is-opening-selected');
    });
    block.addEventListener('dblclick', (event) => {
      event.preventDefault();
      openDialog(openingForBlock(block));
    });
    block.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openDialog(openingForBlock(block));
    });
  });
  form.addEventListener('change', setScopeState);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveSelection();
  });
  saveButton.addEventListener('click', () => { void saveSelection(); });
  closeButtons.forEach((button) => button.addEventListener('click', () => dialog.close()));
  window.addEventListener('hashchange', focusOpenings);
  focusOpenings();
})();
