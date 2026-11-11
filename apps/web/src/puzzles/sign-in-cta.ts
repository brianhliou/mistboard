import { loginHrefForCurrentPage, registerHrefForCurrentPage } from '../auth-redirect.js';
import { t } from '../i18n/catalog.js';

// A guest's invitation to keep their score: a line saying why, then Register
// (filled, the header's button) and Sign in (outlined), both returning here.
export function signInCta(lead: string, className = ''): HTMLElement {
  const box = document.createElement('div');
  box.className = `puzzle-signin-cta ${className}`.trim();
  const text = document.createElement('p');
  text.className = 'puzzle-signin-cta-lead';
  text.textContent = lead;
  const actions = document.createElement('div');
  actions.className = 'puzzle-signin-cta-actions';
  const register = document.createElement('a');
  register.className = 'puzzle-signin-cta-register';
  register.href = registerHrefForCurrentPage();
  register.textContent = t('nav.register');
  const signIn = document.createElement('a');
  signIn.className = 'puzzle-signin-cta-login';
  signIn.href = loginHrefForCurrentPage();
  signIn.textContent = t('nav.signIn');
  actions.append(register, signIn);
  box.append(text, actions);
  return box;
}
