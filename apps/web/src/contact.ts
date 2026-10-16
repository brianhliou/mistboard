// Contact form. Extracted from landing.ts.
//
// Owns the /contact form DOM, lane-shape (anon vs signed-in), honeypot,
// submit/error states, and the applyAuth reconciliation hook called once
// /api/auth/me resolves.

import './contact.css';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';

// Minimal subset of AuthUser — kept in sync with landing.ts. Promote to a
// shared types module if a third caller appears.
type AuthUser = {
  email: string;
  handle: string;
};

export interface ContactView {
  el: HTMLElement;
  applyAuth: (user: AuthUser | null) => void;
}

export function buildContact(
  initialUser: AuthUser | null,
  initialSignedInHint: boolean,
  locale: Locale = currentLocale(),
): ContactView {
  // Three initial states: confirmed user (cached object → render real banner),
  // hinted signed-in (boolean only → render placeholder banner), or anon.
  const initialSignedIn = initialUser !== null || initialSignedInHint;

  const section = document.createElement('section');
  section.className = 'site-section contact-section';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('contact.heading', {}, locale);

  const introAnon = t('contact.introAnon', {}, locale);
  const introUser = t('contact.introUser', {}, locale);

  const intro = document.createElement('p');
  intro.className = 'contact-intro';
  intro.textContent = initialSignedIn ? introUser : introAnon;

  // Public questions go to the forum; this page is the private lane only.
  const forumNote = document.createElement('p');
  forumNote.className = 'contact-forum-note';
  const forumLink = document.createElement('a');
  forumLink.href = localizedHref('/forum', locale);
  forumLink.textContent = t('contact.forumLink', {}, locale);
  forumNote.append(
    document.createTextNode(t('contact.forumPrefix', {}, locale)),
    forumLink,
    document.createTextNode(t('contact.forumSuffix', {}, locale)),
  );

  const replyNote = document.createElement('p');
  replyNote.className = 'contact-reply-note';
  replyNote.textContent = t('contact.replyNote', {}, locale);

  const form = document.createElement('form');
  form.className = 'contact-form';
  form.noValidate = true;

  const messageLabel = document.createElement('label');
  messageLabel.className = 'contact-field';
  const messageLabelText = document.createElement('span');
  messageLabelText.textContent = t('contact.message', {}, locale);
  const messageInput = document.createElement('textarea');
  messageInput.name = 'message';
  messageInput.required = true;
  messageInput.rows = 6;
  messageInput.maxLength = 5000;
  messageInput.placeholder = t('contact.messagePlaceholder', {}, locale);
  messageLabel.append(messageLabelText, messageInput);

  // Lane slot: rendered in user-lane shape if we have a synchronous hint that
  // the visitor is signed in (localStorage), otherwise anon. Reconciled with
  // the real auth fetch via applyAuth below.
  const laneSlot = document.createElement('div');
  laneSlot.className = 'contact-lane-slot';

  // Anon-lane elements (kept around to swap back into if needed).
  const emailLabel = document.createElement('label');
  emailLabel.className = 'contact-field';
  const emailLabelText = document.createElement('span');
  emailLabelText.textContent = t('contact.emailOptional', {}, locale);
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.name = 'email';
  emailInput.autocomplete = 'email';
  emailInput.placeholder = 'you@example.com';
  emailLabel.append(emailLabelText, emailInput);

  const signinPrompt = document.createElement('p');
  signinPrompt.className = 'contact-signin-prompt';
  const signinLink = document.createElement('a');
  signinLink.href = localizedHref('/account', locale);
  signinLink.textContent = t('nav.signIn', {}, locale);
  signinPrompt.append(
    signinLink,
    document.createTextNode(t('contact.signInForFasterReply', {}, locale)),
  );

  const buildAnonSlot = (): void => {
    laneSlot.dataset.lane = 'anon';
    laneSlot.replaceChildren(emailLabel, signinPrompt);
  };

  const buildUserSlot = (user: AuthUser | null): void => {
    laneSlot.dataset.lane = 'user';
    const hint = document.createElement('p');
    hint.className = 'contact-signed-in-hint';
    if (user) {
      hint.append(
        document.createTextNode(`${t('contact.signedInAs', {}, locale)} `),
        Object.assign(document.createElement('strong'), { textContent: `@${user.handle}` }),
      );
      if (user.email) {
        hint.append(
          document.createTextNode(`. ${t('contact.replyToEmail', { email: user.email }, locale)}`),
        );
      } else {
        hint.append(document.createTextNode('.'));
      }
    } else {
      // Placeholder used when we only have the localStorage hint and haven't
      // yet resolved the authoritative user.
      hint.textContent = t('contact.replyToAccountEmail', {}, locale);
    }
    laneSlot.replaceChildren(hint);
  };

  // Initial paint. If we have the full user object, render the real banner
  // immediately (no placeholder→real swap when /api/auth/me resolves).
  if (initialUser) buildUserSlot(initialUser);
  else if (initialSignedInHint) buildUserSlot(null);
  else buildAnonSlot();

  // Honeypot: hidden from humans, attractive to bots. Server discards if filled.
  const honeypotLabel = document.createElement('label');
  honeypotLabel.setAttribute('aria-hidden', 'true');
  honeypotLabel.style.position = 'absolute';
  honeypotLabel.style.left = '-9999px';
  honeypotLabel.style.opacity = '0';
  honeypotLabel.style.pointerEvents = 'none';
  honeypotLabel.tabIndex = -1;
  const honeypotInput = document.createElement('input');
  honeypotInput.type = 'text';
  honeypotInput.name = 'website';
  honeypotInput.autocomplete = 'off';
  honeypotInput.tabIndex = -1;
  honeypotLabel.append(t('contact.website', {}, locale), honeypotInput);

  const submitRow = document.createElement('div');
  submitRow.className = 'contact-submit-row';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'contact-submit';
  submit.textContent = t('contact.send', {}, locale);
  const status = document.createElement('span');
  status.className = 'contact-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  submitRow.append(submit, status);

  form.append(messageLabel, laneSlot, honeypotLabel, submitRow);

  // Closure flag: when true, omit the email from the submitted payload
  // (server ignores it anyway, but no point sending it).
  let signedIn = initialSignedIn;

  const applyAuth = (user: AuthUser | null): void => {
    if (user) {
      signedIn = true;
      buildUserSlot(user);
      intro.textContent = introUser;
    } else {
      // Authoritative: not signed in. Either confirms the anon default or
      // reverts a stale signed-in hint (sign-out from another tab, etc.).
      signedIn = false;
      buildAnonSlot();
      intro.textContent = introAnon;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const message = messageInput.value.trim();
    if (message.length === 0) {
      status.textContent = t('contact.enterMessage', {}, locale);
      status.dataset.state = 'error';
      messageInput.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = t('contact.sending', {}, locale);
    status.dataset.state = 'pending';

    void (async () => {
      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message,
            email: signedIn ? null : emailInput.value.trim() || null,
            path: window.location.pathname,
            website: honeypotInput.value,
          }),
        });
        if (response.ok) {
          messageInput.value = '';
          if (!signedIn) emailInput.value = '';
          status.textContent = t('contact.thanks', {}, locale);
          status.dataset.state = 'ok';
        } else if (response.status === 429) {
          status.textContent = signedIn
            ? t('contact.tooManySubmissions', {}, locale)
            : t('contact.dailyLimit', {}, locale);
          status.dataset.state = 'error';
        } else {
          status.textContent = t('contact.sendFailed', {}, locale);
          status.dataset.state = 'error';
        }
      } catch {
        status.textContent = t('contact.networkError', {}, locale);
        status.dataset.state = 'error';
      } finally {
        submit.disabled = false;
      }
    })();
  });

  // The form sits straight on the page panel: a bordered card inside the
  // panel read as boxes in boxes.
  section.append(heading, intro, forumNote, replyNote, form);
  return { el: section, applyAuth };
}
