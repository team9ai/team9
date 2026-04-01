export interface EmailChangeConfirmationData {
  username: string;
  currentEmail: string;
  confirmationLink: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const emailChangeConfirmationTemplate = (
  data: EmailChangeConfirmationData,
) => {
  const username = escapeHtml(data.username);
  const currentEmail = escapeHtml(data.currentEmail);
  const confirmationLink = escapeHtml(data.confirmationLink);

  return {
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed; margin: 0;">Team9</h1>
  </div>

  <h2 style="color: #1f2937;">Confirm your new email address</h2>

  <p>Hi ${username},</p>

  <p>We received a request to change the Team9 account email for ${currentEmail} to this address.</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${confirmationLink}"
       style="display: inline-block; background-color: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
      Confirm Email Change
    </a>
  </div>

  <p style="color: #6b7280; font-size: 14px;">
    This link will expire in 24 hours. If you didn't request this email change, you can safely ignore this message.
  </p>

  <p style="color: #6b7280; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${confirmationLink}" style="color: #7c3aed; word-break: break-all;">${confirmationLink}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

  <p style="color: #9ca3af; font-size: 12px; text-align: center;">
    Team9 - Team Collaboration Platform
  </p>
</body>
</html>
  `.trim(),
    text: `
Hi ${data.username},

We received a request to change the Team9 account email for ${data.currentEmail} to this address.

Confirm the change here:
${data.confirmationLink}

This link will expire in 24 hours. If you didn't request this email change, you can safely ignore this message.

Team9 - Team Collaboration Platform
  `.trim(),
  };
};
