# 18. Free Mail Merge for Life

**Time: 45 minutes. Cost: $0. Code: Google Apps Script.**

A personalized email to your whole list, sent from a spreadsheet. No Cloudflare in this one at all.

---

## What you get

A Google Sheet where each row is a person and each email goes out with their name, and anything else you put in a column, dropped into the message. Run it once, it skips anyone already sent to, so re-running is always safe.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Mailchimp | $20 to $350 per month | Priced by list size, climbs fast |
| Lemlist | $59 to $99 per month | Built for cold outreach, expensive for occasional use |
| Constant Contact | $12 to $80 per month | Templates locked behind higher tiers |

---

## What is actually free and what is not

Free, with a real daily ceiling that comes from Google, not from this guide. A personal Gmail account can send to **100 recipients a day**. A Google Workspace account gets **1,500 a day**. This is Google's number, not a marketing cap someone set to upsell you, and it resets 24 hours after your first send of the day, not at midnight.

For a list of a few hundred, split it across two or three days. For anything larger and more frequent than that, this stops being the right tool.

---

## Prerequisites

- Guide 01 complete. Part B, the Gmail "send as" alias, is optional here but means the email can come from your business address instead of your personal Gmail.
- A Google account. You already have one if you have used any of the Google-based guides in this library.

This does not require Cloudflare, D1, or anything from guide 00. If you exported leads as a CSV in guide 03, that CSV is a natural list to import here, but any spreadsheet works.

---

## Step 1. Make the sheet

Go to `https://sheets.google.com`, create a blank spreadsheet.

Row 1 is headers. Set up at least these three columns, in this order:

| Email | FirstName | Status |
|---|---|---|
| jane@example.com | Jane | |
| tom@example.com | Tom | |

Add more columns for anything else you want to personalize, a business name, an amount, whatever. The column header becomes the merge tag.

If you have a leads CSV from guide 03: **File** → **Import** → **Upload**, choose the CSV, select **Insert new sheet** or replace the current one. Add a `Status` column afterward if it is not already there.

## Step 2. Open the script editor

**Extensions** → **Apps Script**. A new tab opens with a blank code editor.

Delete anything in there and paste this:

```javascript
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Mail Merge")
    .addItem("Send test to myself", "sendTestToMyself")
    .addItem("Send to everyone not yet sent", "sendMailMerge")
    .addToUi();
}

const SUBJECT_TEMPLATE = "Hi {{FirstName}}, quick note";
const BODY_TEMPLATE =
  "Hi {{FirstName}},\n\n" +
  "Your message here. Reference any column with {{ColumnName}}.\n\n" +
  "Best,\n" +
  "Your Name";

function sendTestToMyself() {
  const me = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: "TEST: " + SUBJECT_TEMPLATE.split("{{FirstName}}").join("Test"),
    body: BODY_TEMPLATE.split("{{FirstName}}").join("Test")
  });
}

function sendMailMerge() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const emailCol = headers.indexOf("Email");
  const statusCol = headers.indexOf("Status");

  if (emailCol === -1 || statusCol === -1) {
    throw new Error("Sheet needs a column named Email and a column named Status.");
  }

  let queued = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailCol] && data[i][statusCol] !== "sent") queued++;
  }

  const quota = MailApp.getRemainingDailyQuota();
  if (queued > quota) {
    throw new Error(
      "Only " + quota + " emails left today, but " + queued + " are queued. " +
      "Run again tomorrow for the rest, or send a smaller batch."
    );
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[emailCol] || row[statusCol] === "sent") continue;

    let subject = SUBJECT_TEMPLATE;
    let body = BODY_TEMPLATE;
    headers.forEach((header, col) => {
      const token = "{{" + header + "}}";
      subject = subject.split(token).join(row[col]);
      body = body.split(token).join(row[col]);
    });

    MailApp.sendEmail({ to: row[emailCol], subject: subject, body: body });

    sheet.getRange(i + 1, statusCol + 1).setValue("sent");
    Utilities.sleep(1000); // a small gap between sends, not a burst
  }
}
```

Click the disk icon, or Ctrl+S, to save. Name the project anything.

> **Why `Status` gets checked and set for every row.** Without it, running the script twice emails everyone twice. Marking each row `sent` right after it goes out means the script is safe to re-run any time, on purpose or by accident. It only ever sends to rows that still need it.

## Step 3. Write your actual message

Edit the two constants near the top, `SUBJECT_TEMPLATE` and `BODY_TEMPLATE`. Any `{{ColumnName}}` matching one of your sheet's headers gets replaced with that row's value.

## Step 4. Authorize it

Back in the script editor, use the function dropdown near the run button to select `sendTestToMyself`, then click **Run**.

Google will interrupt with a permissions screen the first time. Click through: **Advanced** → **Go to (your project name), unsafe** → **Allow**. This warning appears because it is your own unpublished script, not because anything is actually wrong. Google shows this screen for any script that was not submitted for their app review process, which is not something a personal tool like this needs.

## Step 5. Check the test email

Look at the inbox for whichever Google account you are logged into. You should have a test email within a few seconds, with the merge tag replaced by "Test."

## Step 6. Send it for real

Go back to your Sheet tab. Reload the page. A new menu, **Mail Merge**, appears in the menu bar. Click it, then **Send to everyone not yet sent**.

Watch the `Status` column fill in with `sent` as it goes.

---

## Optional: send from your business address

If you completed guide 01 Part B, replace `MailApp.sendEmail` with `GmailApp.sendEmail` in both functions, and add a `from` field:

```javascript
GmailApp.sendEmail(row[emailCol], subject, body, {
  from: "hello@yourbusiness.com"
});
```

This only works if that address is already set up as a verified "send as" alias in your Gmail settings, which guide 01 Part B did. Without that step, this will fail.

---

## Verify it works

- [ ] `sendTestToMyself` delivers a test email with the merge tag correctly replaced
- [ ] Running `sendMailMerge` marks each sent row `sent` in the sheet
- [ ] Running `sendMailMerge` a second time immediately sends nothing, since every row is already marked
- [ ] Adding a brand new row and running it again sends only to that new row
- [ ] `MailApp.getRemainingDailyQuota()` correctly stops a batch that would exceed what is left today, run it directly in the script editor to check your current number any time

---

## What breaks and how to fix it

**"Sheet needs a column named Email and a column named Status"**
A header is spelled differently than expected, spacing or capitalization included. The script matches header text exactly.

**Permission screen keeps reappearing every run**
Normal the first time per Google account, should not recur after you complete the Allow flow once. If it keeps happening, you may be running it from a different Google account than the one that authorized it.

**Some rows get skipped that should have sent**
Their `Email` cell is blank, or their `Status` cell already contains something other than blank, even a stray space counts as "already handled" only if it exactly equals the text `sent`. Check for typos in that column specifically.

**Emails land in spam**
Google's own sending reputation covers you reasonably well for low volume, but if you are seeing this consistently, review your message for spam-trigger patterns, excessive links, ALL CAPS subject lines, and keep the send rate as written, one per second, rather than removing the `Utilities.sleep(1000)` line to go faster.

**Script fails partway through a large batch**
Check `Status` immediately. Everyone marked `sent` already went out successfully. Re-running only continues from where it stopped, nothing gets duplicated.

**"Exceeded maximum execution time"**
Apps Script cuts off any single run at 6 minutes. At one send per second, that is roughly 300 emails per run, well above the free daily quota anyway, so this should not come up on a personal account. On a Workspace account sending near the 1,500 daily cap, split into two menu clicks instead of one.

---

## What to do next

That is every guide sharing the Stripe and mail infrastructure. Guide 12, Free Lead Dashboard for Life, is next, and it is the first of a run that turns raw data into something you can actually act on.

---

## Sources to verify yourself

- Apps Script quotas: `https://developers.google.com/apps-script/guides/services/quotas`
- MailApp reference: `https://developers.google.com/apps-script/reference/mail/mail-app`
