export interface PasswordResetData {
  username: string;
  resetLink: string;
}

export const passwordResetTemplate = (data: PasswordResetData) => ({
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

  <h2 style="color: #1f2937;">Reset your password</h2>

  <p>Hi ${data.username},</p>

  <p>We received a request to reset your password. Click the button below to create a new password:</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${data.resetLink}"
       style="display: inline-block; background-color: #7c3aed; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
      Reset Password
    </a>
  </div>

  <p style="color: #6b7280; font-size: 14px;">
    This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
  </p>

  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0;">
    <p style="margin: 0; color: #92400e; font-size: 14px;">
      <strong>Security tip:</strong> Never share this link with anyone. Team9 will never ask for your password.
    </p>
  </div>

  <p style="color: #6b7280; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${data.resetLink}" style="color: #7c3aed; word-break: break-all;">${data.resetLink}</a>
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

We received a request to reset your password. Click the link below to create a new password:

${data.resetLink}

This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.

Security tip: Never share this link with anyone. Team9 will never ask for your password.

Team9 - Team Collaboration Platform
  `.trim(),
});
