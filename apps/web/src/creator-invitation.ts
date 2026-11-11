import './creator-invitation.css';
import { t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';

// Shared presentation, with separate offers grounded in each page's actual tools.
export function buildCreatorInvitation(kind: 'coach' | 'streamer', locale: Locale): HTMLElement {
  const section = document.createElement('section');
  section.className = 'creator-invitation';
  const copy = (
    part:
      | 'heading'
      | 'lede'
      | 'firstTitle'
      | 'firstBody'
      | 'secondTitle'
      | 'secondBody'
      | 'next'
      | 'contact',
  ) => t(`${kind}.invite.${part}`, {}, locale);
  const heading = document.createElement('h2');
  heading.textContent = copy('heading');
  const lede = document.createElement('p');
  lede.className = 'creator-invitation-lede';
  lede.textContent = copy('lede');
  const features = document.createElement('div');
  features.className = 'creator-invitation-features';
  for (const [title, body] of [
    ['firstTitle', 'firstBody'],
    ['secondTitle', 'secondBody'],
  ] as const) {
    const feature = document.createElement('div');
    const label = document.createElement('h3');
    label.textContent = copy(title);
    const paragraph = document.createElement('p');
    paragraph.textContent = copy(body);
    feature.append(label, paragraph);
    features.append(feature);
  }
  const next = document.createElement('p');
  next.className = 'creator-invitation-next';
  next.textContent = copy('next');
  const actions = document.createElement('div');
  actions.className = 'creator-invitation-actions';
  const contact = document.createElement('a');
  contact.className = 'creator-invitation-contact';
  contact.href = `/contact?about=/${kind}`;
  contact.textContent = copy('contact');
  const studies = document.createElement('a');
  studies.href = '/study';
  studies.textContent = t('coach.invite.studies', {}, locale);
  actions.append(contact, studies);
  section.append(heading, lede, features, next, actions);
  return section;
}
