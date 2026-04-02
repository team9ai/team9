import { describe, expect, it } from '@jest/globals';
import { emailChangeConfirmationTemplate } from '../../../../libs/email/src/templates/email-change-confirmation.template.js';

describe('emailChangeConfirmationTemplate', () => {
  it('escapes the confirmation link in the HTML body', () => {
    const confirmationLink =
      'https://example.com/confirm?next="><script>alert(1)</script>&ok=1';

    const result = emailChangeConfirmationTemplate({
      username: 'Alice',
      currentEmail: 'alice@example.com',
      confirmationLink,
    });

    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain(
      'https://example.com/confirm?next=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;ok=1',
    );
  });
});
