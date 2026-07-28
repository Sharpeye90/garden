type MagicLinkEmail = {
  email: string;
  magicLink: string;
};

export async function sendMagicLinkEmail({
  email,
  magicLink,
}: MagicLinkEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.GARDEN_EMAIL_FROM?.trim();
  if (!apiKey || !from) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Вход в Ритм сада",
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#26352b">
        <h1 style="font-family:Georgia,serif;font-weight:500">Войти в Ритм сада</h1>
        <p>Ссылка действует 15 минут и может быть использована один раз.</p>
        <p><a href="${escapeAttribute(magicLink)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#315b43;color:white;text-decoration:none">Открыть мой сад</a></p>
        <p style="color:#69746c;font-size:13px">Если вы не запрашивали вход, просто проигнорируйте это письмо.</p>
      </div>`,
    }),
  });
  return response.ok;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
