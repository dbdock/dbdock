import { buildDashboardUrl } from './open-url';

describe('buildDashboardUrl', () => {
  it('builds an org-scoped URL when an organization is present', () => {
    expect(buildDashboardUrl('proj_1', 'org_9', 'https://app.example')).toBe(
      'https://app.example/orgs/org_9/projects/proj_1',
    );
  });

  it('builds an unscoped URL and strips trailing slashes when no org', () => {
    expect(buildDashboardUrl('proj_1', null, 'https://app.example/')).toBe(
      'https://app.example/projects/proj_1',
    );
  });
});
