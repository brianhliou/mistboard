import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';

type Token = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
type Grant = { tourSlug: string; name: string; tokens: Token[] };
const endpoint = '/api/account/broadcast-push';

/** Keep the section absent until an authenticated grant list authorizes it. */
export function buildBroadcastPushSettings(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.hidden = true;
  section.className = 'account-broadcast-push';
  void load();
  return section;

  async function load() {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = (await response.json()) as { grants: Grant[] };
      if (!response.ok || !data.grants?.length) return;
      const heading = document.createElement('h2');
      heading.textContent = t('account.broadcastPush', {}, locale);
      const copy = document.createElement('p');
      copy.textContent = t('account.broadcastPushHelp', {}, locale);
      section.append(heading, copy, ...data.grants.map(buildGrant));
      section.hidden = false;
    } catch {
      /* Accounts without access see no section, including offline loads. */
    }
  }

  function buildGrant(grant: Grant): HTMLElement {
    const block = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = grant.name;
    const form = document.createElement('form');
    form.className = 'account-settings-form';
    const label = document.createElement('label');
    label.className = 'account-field';
    const labelText = document.createElement('span');
    labelText.textContent = t('account.broadcastPushLabel', {}, locale);
    const input = document.createElement('input');
    input.name = 'broadcastPushLabel';
    input.required = true;
    input.maxLength = 100;
    label.append(labelText, input);
    const create = button(t('account.broadcastPushCreate', {}, locale));
    create.type = 'submit';
    const status = document.createElement('p');
    status.className = 'account-status';
    status.setAttribute('role', 'status');
    const once = document.createElement('div');
    const list = document.createElement('div');
    form.append(label, create);
    block.append(heading, form, status, once, list);
    renderTokens();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (create.disabled) return;
      create.disabled = true;
      status.textContent = '';
      try {
        const response = await fetch(`${endpoint}/${encodeURIComponent(grant.tourSlug)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: input.value }),
        });
        const data = (await response.json()) as { token: string; metadata: Token; error?: string };
        if (!response.ok) {
          status.textContent =
            data.error === 'token_limit'
              ? t('account.broadcastPushLimit', {}, locale)
              : data.error === 'rate_limited'
                ? t('account.tooManyAttempts', {}, locale)
                : t('account.broadcastPushFailed', {}, locale);
          return;
        }
        grant.tokens.push(data.metadata);
        input.value = '';
        once.replaceChildren();
        once.dataset.tokenId = data.metadata.id;
        const warning = document.createElement('p');
        warning.textContent = t('account.broadcastPushOnce', {}, locale);
        const value = document.createElement('code');
        value.textContent = data.token;
        value.style.overflowWrap = 'anywhere';
        const copy = button(t('account.broadcastPushCopy', {}, locale));
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(data.token);
            status.textContent = t('account.broadcastPushCopied', {}, locale);
          } catch {
            status.textContent = t('account.broadcastPushCopyFailed', {}, locale);
          }
        });
        const dismiss = button(t('account.broadcastPushDismiss', {}, locale));
        dismiss.addEventListener('click', () => once.replaceChildren());
        once.append(warning, value, document.createElement('br'), copy, dismiss);
        renderTokens();
      } catch {
        status.textContent = t('account.broadcastPushFailed', {}, locale);
      } finally {
        create.disabled = false;
      }
    });
    return block;

    function renderTokens() {
      list.replaceChildren();
      for (const token of grant.tokens) {
        const row = document.createElement('div');
        row.className = 'account-session-row';
        const name = document.createElement('strong');
        name.textContent = token.label;
        const details = document.createElement('div');
        details.className = 'account-session-details';
        const dates = document.createElement('span');
        dates.textContent = `${t('account.broadcastPushCreated', {}, locale)}: ${date(token.createdAt)}. ${t('account.broadcastPushLastUsed', {}, locale)}: ${token.lastUsedAt ? date(token.lastUsedAt) : t('account.broadcastPushNever', {}, locale)}.`;
        details.append(name, dates);
        row.append(details);
        if (token.revokedAt) {
          const revoked = document.createElement('span');
          revoked.textContent = t('account.broadcastPushRevoked', {}, locale);
          row.append(revoked);
        } else {
          const revoke = button(t('account.broadcastPushRevoke', {}, locale));
          revoke.classList.add('account-session-revoke');
          revoke.addEventListener('click', async () => {
            revoke.disabled = true;
            try {
              const response = await fetch(
                `${endpoint}/${encodeURIComponent(grant.tourSlug)}/${encodeURIComponent(token.id)}`,
                { method: 'DELETE' },
              );
              if (!response.ok) throw new Error('revoke_failed');
              token.revokedAt = new Date().toISOString();
              if (once.dataset.tokenId === token.id) once.replaceChildren();
              status.textContent = '';
              renderTokens();
            } catch {
              status.textContent = t('account.broadcastPushFailed', {}, locale);
              revoke.disabled = false;
            }
          });
          row.append(revoke);
        }
        list.append(row);
      }
    }
  }

  function date(value: string): string {
    return new Date(value).toLocaleString(locale);
  }
}

function button(text: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'landing-setup-back';
  element.textContent = text;
  return element;
}
