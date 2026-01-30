export interface MagicLoginData {
  username: string;
  loginLink: string;
}

export const magicLoginTemplate = (data: MagicLoginData) => ({
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

  <h2 style="color: #1f2937;">Sign in to Team9</h2>

  <p>Hi ${data.username},</p>

  <p>Click the button below to sign in to your Team9 account:</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${data.loginLink}"
       style="display: inline-block; background-color: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
      Sign In to Team9
    </a>
  </div>

  <p style="color: #6b7280; font-size: 14px;">
    This link will expire in 24 hours. If you didn't request this, you can safely ignore this email.
  </p>

  <p style="color: #6b7280; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${data.loginLink}" style="color: #7c3aed; word-break: break-all;">${data.loginLink}</a>
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

Click the link below to sign in to your Team9 account:

${data.loginLink}

This link will expire in 24 hours. If you didn't request this, you can safely ignore this email.

Team9 - Team Collaboration Platform
  `.trim(),
});
