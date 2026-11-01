import { LoginThrottle } from './login-throttle';

describe('LoginThrottle', () => {
  it('bloque une adresse après N échecs pendant la fenêtre, puis la libère', () => {
    let t = 0;
    const throttle = new LoginThrottle(3, 60_000, () => t);
    throttle.failed('1.2.3.4');
    throttle.failed('1.2.3.4');
    expect(throttle.retryAfterSec('1.2.3.4')).toBe(0);
    throttle.failed('1.2.3.4');
    expect(throttle.retryAfterSec('1.2.3.4')).toBe(60);
    expect(throttle.retryAfterSec('5.6.7.8')).toBe(0); // une autre adresse n'est pas touchée
    t = 30_000;
    expect(throttle.retryAfterSec('1.2.3.4')).toBe(30);
    t = 60_000;
    expect(throttle.retryAfterSec('1.2.3.4')).toBe(0); // fenêtre passée
  });

  it('une connexion réussie remet le compteur à zéro', () => {
    const throttle = new LoginThrottle(2, 60_000, () => 0);
    throttle.failed('a');
    throttle.succeeded('a');
    throttle.failed('a');
    expect(throttle.retryAfterSec('a')).toBe(0);
  });
});
