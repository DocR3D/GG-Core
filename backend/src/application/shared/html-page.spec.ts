import { htmlPage } from './html-page';
import { runWithSession } from './request-session';

const nav = (html: string) => /<header>(.*)<\/header>/.exec(html)?.[1] ?? '';

describe('htmlPage - barre du site', () => {
  it('sans session : lien Connexion', () => {
    const bar = nav(htmlPage({ title: 't', body: '' }));
    expect(bar).toContain('<a href="/login">Connexion</a>');
    expect(bar).not.toContain('Se déconnecter');
  });

  it('connecté : son nom (échappé) et Se déconnecter, plus de Connexion', () => {
    const html = runWithSession({ sub: '76561198000000001', role: 'player', name: 'Zap<3', via: 'steam' }, () =>
      htmlPage({ title: 't', body: '' }),
    );
    const bar = nav(html);
    expect(bar).toContain('<li>Zap&lt;3</li>');
    expect(bar).toContain('<a href="/auth/logout">Se déconnecter</a>');
    expect(bar).not.toContain('>Connexion<');
  });
});
