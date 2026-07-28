(() => {
  'use strict';

  const APP_ID = 'rotations-viewer';
  const MANIFEST_VERSION = 1;
  const alternateStore = window.GymAlternateSchedule;
  const auditStore = window.GymCollisionAudit;
  const weekAnchor = window.GymWeekAnchor;
  const controls = document.querySelector('.controls');

  if (!document.body || !controls) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'rotations-sync-open';
  openButton.dataset.rotationsSyncOpen = '';
  openButton.dataset.state = 'disconnected';
  openButton.textContent = 'Sync & backup';
  const dayPicker = controls.querySelector('[data-day-picker-menu]');
  controls.insertBefore(openButton, dayPicker || null);

  const dialog = document.createElement('dialog');
  dialog.className = 'rotations-sync-dialog';
  dialog.setAttribute('aria-labelledby', 'rotations-sync-title');
  dialog.innerHTML = `
    <div class="rotations-sync-window">
      <div class="rotations-sync-heading">
        <div>
          <p class="rotations-sync-kicker">RYAN-ONLY APP SYNC PILOT</p>
          <h2 id="rotations-sync-title">Sync & backup</h2>
        </div>
        <button type="button" class="rotations-sync-close" data-rotations-sync-close
          aria-label="Close sync and backup window">×</button>
      </div>
      <p class="rotations-sync-copy">
        Alternate schedules and collision audits can sync between Ryan’s browsers.
        The week anchor stays on this device during the pilot because its calendar rule
        still needs a separate repair.
      </p>
      <p class="rotations-sync-safety">
        Only those two registered collections are read. Other browser storage is never scanned,
        replaced, or cleared.
      </p>
      <div class="rotations-sync-state" data-rotations-sync-state data-state="disconnected">
        <strong data-rotations-sync-state-label>Disconnected</strong>
        <span data-rotations-sync-state-message>Local records stay on this device.</span>
      </div>
      <p class="rotations-sync-alert" data-rotations-sync-alert role="alert" hidden></p>
      <div class="rotations-sync-actions">
        <button type="button" class="is-primary" data-rotations-sync-connect data-sync-action>
          Connect as Ryan
        </button>
        <button type="button" data-rotations-sync-now data-sync-action>Sync now</button>
        <button type="button" data-rotations-sync-backup data-sync-action>Download local backup</button>
        <button type="button" data-rotations-sync-preview data-sync-action>
          Create backup & preview
        </button>
        <button type="button" data-rotations-sync-disconnect data-sync-action>Disconnect</button>
        <button type="button" data-rotations-sync-reset data-sync-action>
          Reset device connection
        </button>
      </div>
      <section class="rotations-sync-review" data-rotations-sync-review hidden
        aria-labelledby="rotations-sync-review-title">
        <h3 id="rotations-sync-review-title">Migration preview</h3>
        <p data-rotations-sync-counts></p>
        <p class="rotations-sync-zero-write" data-rotations-sync-zero-write></p>
        <div class="rotations-sync-records" data-rotations-sync-records></div>
        <button type="button" class="is-primary" data-rotations-sync-apply data-sync-action disabled>
          Apply reviewed migration
        </button>
      </section>
      <section class="rotations-sync-conflicts" data-rotations-sync-conflicts hidden
        aria-labelledby="rotations-sync-conflicts-title">
        <h3 id="rotations-sync-conflicts-title">Sync conflicts</h3>
        <p>Choose each result deliberately. No choice is made automatically.</p>
        <div class="rotations-sync-conflict-list" data-rotations-sync-conflict-list></div>
      </section>
      <p class="rotations-sync-footnote">
        Authentication lasts only in this open page. Navigating to another calendar page may
        require connecting again; queued local work remains preserved.
      </p>
      <p class="rotations-sync-footnote">
        If this browser was revoked, reset its device connection before reconnecting.
        Local Rotations records are not removed.
      </p>
    </div>
  `;
  document.body.append(dialog);

  const closeButton = dialog.querySelector('[data-rotations-sync-close]');
  const connectButton = dialog.querySelector('[data-rotations-sync-connect]');
  const syncButton = dialog.querySelector('[data-rotations-sync-now]');
  const backupButton = dialog.querySelector('[data-rotations-sync-backup]');
  const previewButton = dialog.querySelector('[data-rotations-sync-preview]');
  const disconnectButton = dialog.querySelector('[data-rotations-sync-disconnect]');
  const resetButton = dialog.querySelector('[data-rotations-sync-reset]');
  const applyButton = dialog.querySelector('[data-rotations-sync-apply]');
  const stateBox = dialog.querySelector('[data-rotations-sync-state]');
  const stateLabel = dialog.querySelector('[data-rotations-sync-state-label]');
  const stateMessage = dialog.querySelector('[data-rotations-sync-state-message]');
  const alert = dialog.querySelector('[data-rotations-sync-alert]');
  const review = dialog.querySelector('[data-rotations-sync-review]');
  const counts = dialog.querySelector('[data-rotations-sync-counts]');
  const zeroWrite = dialog.querySelector('[data-rotations-sync-zero-write]');
  const records = dialog.querySelector('[data-rotations-sync-records]');
  const conflicts = dialog.querySelector('[data-rotations-sync-conflicts]');
  const conflictList = dialog.querySelector('[data-rotations-sync-conflict-list]');
  const actionButtons = Array.from(dialog.querySelectorAll('[data-sync-action]'));

  let client = null;
  let alternateHandle = null;
  let auditHandle = null;
  let previewResult = null;
  let busy = false;
  let initialized = false;
  let conflictRender = 0;
  let restoreFocus = null;

  const stateLabels = {
    disconnected: 'Disconnected',
    review: 'Migration review required',
    syncing: 'Syncing',
    synced: 'Synced',
    offline: 'Offline',
    conflict: 'Conflict needs review',
  };

  const showAlert = (message = '') => {
    alert.hidden = !message;
    alert.textContent = message;
  };

  const setBusy = (next) => {
    busy = next;
    dialog.setAttribute('aria-busy', String(next));
    actionButtons.forEach((button) => {
      if (button === applyButton && !next) return;
      button.disabled = next;
    });
    if (!next) updateApplyAvailability();
  };

  const downloadJson = (payload, filename) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const rawBackup = () => {
    const keys = [
      alternateStore && alternateStore.storageKey,
      auditStore && auditStore.storageKey,
      weekAnchor && weekAnchor.storageKey,
    ].filter(Boolean);
    return {
      version: 1,
      kind: 'rotations_browser_local_raw_backup',
      app_id: APP_ID,
      exported_at: new Date().toISOString(),
      records: keys.map((key) => {
        const value = window.localStorage.getItem(key);
        return {
          key,
          present: value !== null,
          raw_value: value,
        };
      }),
    };
  };

  const downloadRawBackup = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadJson(rawBackup(), `rotations-browser-local-raw-backup-${today}.json`);
  };

  const requireWriteSource = (metadata) => {
    if (!metadata || !['local', 'remote-migration'].includes(metadata.source)) {
      throw new Error('The sync client requested an invalid local write source.');
    }
  };

  const requireRemoteSource = (metadata) => {
    if (!metadata || !['remote', 'migration'].includes(metadata.source)) {
      throw new Error('The sync client requested an invalid remote write source.');
    }
  };

  const alternateAdapter = {
    scope: APP_ID,
    appId: APP_ID,
    collection: 'alternate-schedules',
    schemaVersion: 1,
    validate: (value, recordId) => alternateStore.isSyncValue(recordId, value),
    listLocal: () => alternateStore.listSyncRecords(),
    writeLocal: (recordId, value, metadata) => {
      requireWriteSource(metadata);
      return alternateStore.applySync(recordId, value, Boolean(metadata.deleted));
    },
    applyRemote: (recordId, value, metadata) => {
      requireRemoteSource(metadata);
      return alternateStore.applySync(recordId, value, Boolean(metadata.deleted));
    },
  };

  const auditAdapter = {
    scope: APP_ID,
    appId: APP_ID,
    collection: 'collision-audits',
    schemaVersion: 1,
    validate: (value, recordId) => auditStore.isSyncValue(recordId, value),
    listLocal: () => auditStore.listSyncRecords(),
    writeLocal: (recordId, value, metadata) => {
      requireWriteSource(metadata);
      return auditStore.applySync(recordId, value, Boolean(metadata.deleted));
    },
    applyRemote: (recordId, value, metadata) => {
      requireRemoteSource(metadata);
      return auditStore.applySync(recordId, value, Boolean(metadata.deleted));
    },
  };

  const invalidatePreview = () => {
    previewResult = null;
    review.hidden = true;
    records.replaceChildren();
    applyButton.disabled = true;
  };

  const stageAlternateChanges = async (detail) => {
    await ready;
    for (const record of detail.changedRecords || []) {
      const synchronized = await alternateStore.toSyncRecord(record);
      await alternateHandle.save(synchronized.recordId, synchronized.value);
    }
    for (const record of detail.removedRecords || []) {
      const synchronized = await alternateStore.toSyncRecord(record);
      await alternateHandle.remove(synchronized.recordId);
    }
  };

  const stageAuditChanges = async (detail) => {
    await ready;
    for (const localRecordId of detail.changedIds || []) {
      const value = detail.store && detail.store.records &&
        detail.store.records[localRecordId];
      const synchronized = auditStore.toSyncRecord(localRecordId, value);
      await auditHandle.save(synchronized.recordId, synchronized.value);
    }
    for (const localRecordId of detail.removedIds || []) {
      const recordId = auditStore.toRemoteRecordId(localRecordId);
      if (!recordId) throw new Error('A removed collision audit has an invalid identity.');
      await auditHandle.remove(recordId);
    }
  };

  if (alternateStore) {
    window.addEventListener(alternateStore.changeEvent, (event) => {
      const detail = event.detail;
      if (!detail || detail.source !== 'local') return;
      invalidatePreview();
      const pending = stageAlternateChanges(detail);
      if (typeof detail.waitUntil === 'function') detail.waitUntil(pending);
    });
  }

  if (auditStore) {
    window.addEventListener(auditStore.changeEvent, (event) => {
      const detail = event.detail;
      if (!detail || detail.source !== 'local') return;
      invalidatePreview();
      const pending = stageAuditChanges(detail);
      if (typeof detail.waitUntil === 'function') detail.waitUntil(pending);
    });
  }

  const updateApplyAvailability = () => {
    if (!applyButton) return;
    if (busy || !previewResult) {
      applyButton.disabled = true;
      return;
    }
    const required = Array.from(records.querySelectorAll('select[data-record-key]'));
    const blocked = records.querySelector('[data-migration-blocked]');
    applyButton.disabled = Boolean(blocked) || required.some((select) => !select.value);
  };

  const makeReviewRow = (item) => {
    const row = document.createElement('div');
    row.className = 'rotations-sync-record';
    const identity = document.createElement('strong');
    identity.textContent = `${item.collection} · ${item.recordId}`;
    const status = document.createElement('span');
    status.className = 'rotations-sync-record-status';
    status.textContent = item.status.replaceAll('-', ' ');
    row.append(identity, status);

    if (item.status === 'content-conflict') {
      const label = document.createElement('label');
      label.textContent = 'Choose result';
      const select = document.createElement('select');
      select.dataset.recordKey = item.recordKey;
      select.innerHTML = `
        <option value="">Choose…</option>
        <option value="keep-local">Keep this device</option>
        <option value="accept-remote">Accept synchronized record</option>
      `;
      select.addEventListener('change', updateApplyAvailability);
      label.append(select);
      row.append(label);
    } else if (item.status === 'schema-conflict' && item.localPresent) {
      const label = document.createElement('label');
      label.textContent = 'This pilot cannot import a different remote schema';
      const select = document.createElement('select');
      select.dataset.recordKey = item.recordKey;
      select.innerHTML = `
        <option value="">Choose…</option>
        <option value="keep-local">Keep this device</option>
      `;
      select.addEventListener('change', updateApplyAvailability);
      label.append(select);
      row.append(label);
    } else if (item.status === 'schema-conflict') {
      const blocked = document.createElement('p');
      blocked.dataset.migrationBlocked = '';
      blocked.textContent =
        'This remote record uses an unsupported schema. Migration is blocked without changing local data.';
      row.append(blocked);
    }
    return row;
  };

  const renderPreview = (result) => {
    previewResult = result;
    review.hidden = false;
    counts.textContent =
      `${result.preview.localCount} local · ${result.preview.remoteCount} synchronized · ` +
      `${result.preview.conflictCount} conflict${result.preview.conflictCount === 1 ? '' : 's'}`;
    zeroWrite.textContent = result.preview.writesPerformed === 0
      ? 'Preview confirmed: 0 writes performed.'
      : 'Preview could not confirm zero writes.';
    zeroWrite.dataset.safe = String(result.preview.writesPerformed === 0);
    records.replaceChildren(...result.preview.review.map(makeReviewRow));
    if (!result.preview.review.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No registered local or synchronized records were found.';
      records.append(empty);
    }
    updateApplyAvailability();
  };

  const renderConflicts = async () => {
    if (!client) return;
    const renderId = ++conflictRender;
    const items = await client.listConflicts();
    if (renderId !== conflictRender) return;
    conflicts.hidden = items.length === 0;
    conflictList.replaceChildren();
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'rotations-sync-conflict';
      const title = document.createElement('strong');
      title.textContent = String(item.recordKey || '').split('\u001f').slice(-2).join(' · ');
      const reason = document.createElement('span');
      reason.textContent = `Reason: ${item.reason || 'conflict'}`;
      const actions = document.createElement('div');
      actions.className = 'rotations-sync-conflict-actions';
      const revision = Number.isInteger(item.current && item.current.revision)
        ? item.current.revision
        : 0;
      for (const [label, strategy] of [
        ['Keep this device', 'keep-local'],
        ['Accept remote', 'accept-remote'],
      ]) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = label;
        choice.addEventListener('click', async () => {
          await runAction(async () => {
            await client.resolveConflict(item.recordKey, {
              strategy,
              expectedRemoteRevision: revision,
            });
            await renderConflicts();
          });
        });
        actions.append(choice);
      }
      card.append(title, reason, actions);
      conflictList.append(card);
    }
  };

  const showState = (state) => {
    const mode = state && state.mode || 'disconnected';
    openButton.dataset.state = mode;
    openButton.title = state && state.message || 'Open sync and backup';
    stateBox.dataset.state = mode;
    stateLabel.textContent = stateLabels[mode] || mode;
    stateMessage.textContent = state && state.message || 'Local records remain on this device.';
    connectButton.hidden = mode !== 'disconnected';
    syncButton.hidden = !['synced', 'offline', 'conflict'].includes(mode);
    previewButton.hidden = mode !== 'review';
    disconnectButton.hidden = mode === 'disconnected';
    resetButton.hidden = mode !== 'disconnected';
    if (mode === 'conflict') void renderConflicts();
    else {
      conflictRender += 1;
      conflicts.hidden = true;
      conflictList.replaceChildren();
    }
  };

  const runAction = async (action) => {
    if (busy) return;
    showAlert('');
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'The action could not be completed safely.');
    } finally {
      setBusy(false);
    }
  };

  const initialize = async () => {
    if (!alternateStore || !auditStore || !weekAnchor) {
      throw new Error('One of the Rotations local data stores did not load.');
    }
    if (!window.RyanAppSync || typeof window.RyanAppSync.create !== 'function') {
      throw new Error('Ryan App Sync is unavailable. Local backup still works.');
    }
    client = window.RyanAppSync.create({
      appId: APP_ID,
      manifestVersion: MANIFEST_VERSION,
      deviceLabel: `Rotations · ${navigator.platform || 'browser'}`,
      showStatus: false,
    });
    client.onStateChange(showState);
    alternateHandle = await client.registerCollection(alternateAdapter);
    auditHandle = await client.registerCollection(auditAdapter);
    await client.finalizeRegistration();
    initialized = true;
    showState(client.getState());
    return true;
  };

  const ready = initialize().catch((error) => {
    showAlert(error instanceof Error ? error.message : 'Ryan App Sync could not initialize.');
    stateMessage.textContent = 'Local backup remains available; synchronization is unavailable.';
    connectButton.hidden = true;
    syncButton.hidden = true;
    previewButton.hidden = true;
    disconnectButton.hidden = true;
    resetButton.hidden = true;
    throw error;
  });
  ready.catch(() => {});

  openButton.addEventListener('click', () => {
    restoreFocus = document.activeElement;
    showAlert('');
    if (!dialog.open) dialog.showModal();
    closeButton.focus();
  });

  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (restoreFocus && typeof restoreFocus.focus === 'function') restoreFocus.focus();
    restoreFocus = null;
  });

  connectButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.connect();
    });
  });

  syncButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.sync();
    });
  });

  backupButton.addEventListener('click', () => {
    void runAction(async () => {
      downloadRawBackup();
      if (!initialized) {
        showAlert('Raw local backup downloaded. Safe sync is not connected on this page.');
        return;
      }
      await client.exportBackup(true);
    });
  });

  previewButton.addEventListener('click', () => {
    void runAction(async () => {
      downloadRawBackup();
      await ready;
      const result = await client.previewMigration({ downloadBackup: true });
      renderPreview(result);
    });
  });

  applyButton.addEventListener('click', () => {
    void runAction(async () => {
      if (!previewResult) throw new Error('Create and review a fresh migration preview.');
      const resolutions = {};
      records.querySelectorAll('select[data-record-key]').forEach((select) => {
        if (select.value) resolutions[select.dataset.recordKey] = select.value;
      });
      await client.applyMigration(previewResult.plan, resolutions);
      invalidatePreview();
    });
  });

  disconnectButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.disconnect();
      invalidatePreview();
    });
  });

  resetButton.addEventListener('click', () => {
    void runAction(async () => {
      await ready;
      await client.resetDevice();
      invalidatePreview();
      showAlert(
        'Device connection reset. Local Rotations records were preserved; connect again and review a fresh migration preview.'
      );
    });
  });

  window.GymRotationsSync = Object.freeze({
    appId: APP_ID,
    manifestVersion: MANIFEST_VERSION,
    ready,
    open: () => openButton.click(),
    rawBackup,
  });
})();
