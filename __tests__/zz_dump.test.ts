import { BUNDLED_GUIDES } from '../src/content/guides';
const want = (process.env.SLUGS ?? '').split(',');
it('dump', () => {
  for (const g of BUNDLED_GUIDES) {
    if (want.includes(g.slug)) {
      console.log(
        `##### ${g.slug}\n${g.body
          .split('\n')
          .filter(l => !l.startsWith('§'))
          .join('\n')}`,
      );
    }
  }
});
