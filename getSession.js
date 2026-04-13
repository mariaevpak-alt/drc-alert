const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = 35310297;
const apiHash = "c2afb7b92faf9d448836ecc14b988579";

(async () => {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("📱 Phone number: "),
    password: async () => await input.text("🔐 2FA password: "),
    phoneCode: async () => await input.text("📩 Code: "),
    onError: (err) => console.log(err),
  });

  console.log("\n✅ SESSION:\n");
  console.log(client.session.save());

  process.exit();
})();