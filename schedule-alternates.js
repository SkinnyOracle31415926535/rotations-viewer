(() => {
  'use strict';

  const api = window.GymAlternateSchedule;
  const scheduleVersion = window.GymScheduleVersion;
  if (!api || !scheduleVersion) return;

  const formatTime = (minutes) => {
    const hour24 = Math.floor(minutes / 60);
    const minute = String(minutes % 60).padStart(2, '0');
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    return `${((hour24 + 11) % 12) + 1}:${minute}${suffix}`;
  };

  const openingHref = (record) => {
    const source = record.source_opening;
    const params = new URLSearchParams({
      sheet: record.source_sheet,
      equipment: source.equipment,
      start: String(source.start_min),
      end: String(source.end_min),
      duration: String(source.duration_min),
      class_name: record.class_name,
    });
    return `Openings_Calendar.html#openings?${params.toString()}`;
  };

  const findTrack = (record) => {
    const section = Array.from(document.querySelectorAll('.day-section[data-sheet]'))
      .find((candidate) => candidate.dataset.sheet === record.source_sheet);
    if (!section) return { section: null, track: null };
    const track = Array.from(section.querySelectorAll('.class-track[data-class-lane]'))
      .find((candidate) => candidate.dataset.classLane === record.class_name);
    return { section, track: track || null };
  };

  const makeCard = (record, stale) => {
    const source = record.source_opening;
    const article = document.createElement('article');
    article.className = `session-block activity-rotation is-modified-event${stale ? ' is-stale-modification' : ''}`;
    article.dataset.alternateScheduleId = record.id;
    article.dataset.classLabel = record.class_name;
    article.dataset.bookingId = `alternate:${record.id}`;
    article.setAttribute('aria-label',
      `${stale ? 'Stale ' : ''}personal schedule modification. ${record.class_name} at ${source.equipment}, ` +
      `${formatTime(source.start_min)} to ${formatTime(source.end_min)}. ${api.scopeLabel(record.scope)}. ` +
      'This is not part of the published schedule.'
    );
    article.title = article.getAttribute('aria-label');

    const time = document.createElement('time');
    time.className = 'session-time';
    time.textContent = `${formatTime(source.start_min)}–${formatTime(source.end_min)}`;
    const station = document.createElement('strong');
    station.textContent = source.equipment;
    const label = document.createElement('span');
    label.className = 'modified-event-label';
    label.textContent = stale ? '⚠ REVIEW MODIFICATION' : 'MY MODIFICATION';
    const scope = document.createElement('em');
    scope.textContent = api.scopeLabel(record.scope);
    article.append(time, station, label, scope);
    return article;
  };

  const makePanel = (records, renderedState) => {
    const oldPanel = document.querySelector('[data-alternate-schedule-panel]');
    if (oldPanel) oldPanel.remove();

    const panel = document.createElement('section');
    panel.className = 'alternate-schedule-panel';
    panel.dataset.alternateSchedulePanel = '';
    panel.setAttribute('aria-labelledby', 'alternate-schedule-heading');

    const headingRow = document.createElement('div');
    headingRow.className = 'alternate-schedule-heading';
    const headingCopy = document.createElement('div');
    const kicker = document.createElement('p');
    kicker.className = 'alternate-schedule-kicker';
    kicker.textContent = 'BROWSER-LOCAL OVERLAY';
    const heading = document.createElement('h2');
    heading.id = 'alternate-schedule-heading';
    heading.textContent = 'My alternate schedule';
    const intro = document.createElement('p');
    intro.textContent = 'These cards are your saved ideas. They never replace or rewrite the published schedule.';
    headingCopy.append(kicker, heading, intro);
    const addLink = document.createElement('a');
    addLink.className = 'alternate-schedule-add';
    addLink.href = 'Openings_Calendar.html';
    addLink.textContent = 'Pick an opening';
    headingRow.append(headingCopy, addLink);
    panel.append(headingRow);

    const legend = document.createElement('div');
    legend.className = 'schedule-state-legend';
    legend.setAttribute('aria-label', 'Schedule card color key');
    [
      ['authoritative', 'Published schedule'],
      ['modified', 'My modification'],
      ['stale', 'Needs review'],
      ['collision', 'Collision'],
    ].forEach(([kind, label]) => {
      const item = document.createElement('span');
      item.className = `schedule-state-key is-${kind}`;
      item.textContent = label;
      legend.append(item);
    });
    panel.append(legend);

    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'alternate-schedule-empty';
      empty.textContent = 'No personal modifications saved yet. Open the Openings page and double-click an opening card.';
      panel.append(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'alternate-schedule-list';
      records.forEach((record) => {
        const state = renderedState.get(record.id) || {};
        const item = document.createElement('li');
        if (state.stale) item.classList.add('is-stale');
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${record.class_name} · ${record.source_opening.equipment} · ` +
          `${formatTime(record.source_opening.start_min)}–${formatTime(record.source_opening.end_min)}`;
        const detail = document.createElement('span');
        detail.textContent = `${api.scopeLabel(record.scope)} · not in the published schedule`;
        copy.append(title, detail);
        if (state.reason) {
          const warning = document.createElement('span');
          warning.className = 'alternate-schedule-warning';
          warning.textContent = `⚠ ${state.reason}`;
          copy.append(warning);
        }

        const actions = document.createElement('div');
        actions.className = 'alternate-schedule-item-actions';
        const show = document.createElement('a');
        show.href = state.section ? `#${state.section.id}` : openingHref(record);
        show.textContent = state.section ? 'Show card' : 'Review opening';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          if (!window.confirm('Remove this personal schedule modification? The published schedule will not change.')) return;
          if (api.remove(record.id)) window.location.reload();
        });
        actions.append(show, remove);
        item.append(copy, actions);
        list.append(item);
      });
      panel.append(list);
    }

    const filter = document.querySelector('[data-class-filter]');
    const main = document.querySelector('main');
    if (filter) {
      filter.insertAdjacentElement('afterend', panel);
    } else if (main) {
      main.prepend(panel);
    }
  };

  const render = () => {
    document.querySelectorAll('[data-alternate-schedule-id]').forEach((card) => card.remove());
    const records = api.read().records
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
    const renderedState = new Map();

    records.forEach((record) => {
      let reason = api.staleReason(record, scheduleVersion);
      const { section, track } = findTrack(record);
      if (!section) {
        reason ||= `The ${record.source_sheet} sheet is not in this published schedule.`;
      } else if (!track) {
        reason ||= `${record.class_name} no longer has a lane on ${record.source_sheet}.`;
      }
      const stale = Boolean(reason);
      renderedState.set(record.id, { stale, reason, section });
      if (track) track.append(makeCard(record, stale));
    });

    makePanel(records, renderedState);
  };

  render();
  window.addEventListener('storage', (event) => {
    if (event.key === api.storageKey) window.location.reload();
  });
})();
