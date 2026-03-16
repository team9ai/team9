export interface VerificationCodeData {
  code: string;
  expiresInMinutes: number;
}

export const verificationCodeTemplate = (data: VerificationCodeData) => ({
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

  <h2 style="color: #1f2937;">Your verification code</h2>

  <p>Use the code below to sign in to Team9:</p>

  <div style="text-align: center; margin: 30px 0;">
    <div style="display: inline-block; background-color: #f3f4f6; padding: 16px 32px; border-radius: 8px; letter-spacing: 6px; font-size: 32px; font-weight: 700; font-family: monospace; color: #1f2937;">
      ${data.code}
    </div>
  </div>

  <p style="color: #6b7280; font-size: 14px;">
    This code will expire in ${data.expiresInMinutes} minutes. If you didn't request this, you can safely ignore this email.
  </p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

  <p style="color: #9ca3af; font-size: 12px; text-align: center;">
    Team9 - Team Collaboration Platform
  </p>
</body>
</html>
  `.trim(),
  text: `
Your Team9 verification code is: ${data.code}

This code will expire in ${data.expiresInMinutes} minutes. If you didn't request this, you can safely ignore this email.

Team9 - Team Collaboration Platform
  `.trim(),
});
