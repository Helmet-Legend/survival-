import * as fs from 'fs';
import * as path from 'path';

import { privacyMarkdown } from '../../src/content/privacy';

const PUBLISHED = path.join(__dirname, '../../docs/confidentialite.md');

describe('politique de confidentialité', () => {
  it('la page publiée est identique au texte affiché dans l’application', () => {
    // Régénérer : UPDATE_PRIVACY=1 npx jest __tests__/content/privacy.test.ts
    if (process.env.UPDATE_PRIVACY === '1') {
      fs.writeFileSync(PUBLISHED, privacyMarkdown());
    }
    expect(fs.readFileSync(PUBLISHED, 'utf8')).toBe(privacyMarkdown());
  });
});
