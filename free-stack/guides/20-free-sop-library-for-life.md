# 20. Free SOP Library for Life

**Time: 45 minutes. Cost: $0. Code: none.**

Every tribal-knowledge answer, written down once, in one place, with proof someone actually read it.

---

## What you get

A folder structure that scales past ten SOPs without turning into chaos, a template that keeps every SOP the same shape, and a way to know who has actually read which one, all built from Google features you already have.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Trainual | $99 to $299 per month | Priced by user count, gets expensive fast with any real team |
| Notion Business | $15 to $20 per user per month | General-purpose tool, SOPs are one use among many, easy to sprawl |
| Confluence | $5.75+ per user per month | Built for engineering teams, overkill for a five-person shop |

The part these tools actually sell is structure and accountability, a consistent format and a record of who read what. Both of those are things Google Workspace already does for free, they are just never assembled into one system on their own.

---

## What is actually free and what is not

All of it, using a personal Google account or the free tier of Workspace. If you are already on a paid Google Workspace plan for other reasons, nothing here adds to that bill.

---

## Prerequisites

- A Google account
- Guide 01 recommended, so `hello@yourbusiness.com` can be the visible owner of these documents instead of a personal Gmail address

---

## Step 1. Build the folder structure

In Google Drive, create a top-level folder called **SOPs**. Inside it, one folder per function, not per task. Task-level folders are how these systems rot within a month.

```
SOPs/
  Sales/
  Operations/
  Customer Service/
  Onboarding/
  Admin/
```

Five is a reasonable starting count. Rename or add to match how your business actually breaks down, do not force it to match this list.

## Step 2. Make the template

Create a new Google Doc named **_SOP Template**, the leading underscore keeps it sorted at the top of every folder. This is the shape every SOP will follow, without exception.

```
[SOP Title]

Purpose
One sentence. Why this exists, what breaks if it is skipped.

Who does this
Role or name, not "whoever is around."

Steps
1.
2.
3.

Common mistakes
What goes wrong when this is rushed or skipped.

Related SOPs
Links to anything upstream or downstream of this one.

Last updated: [date]
Owner: [name]
```

Right-click it, **Move to**, drag a copy into each functional folder as the starting point for that folder's first real SOP.

> **Why every SOP uses the identical shape.** Someone hunting for an answer under pressure should never have to relearn the format before finding the content. A rigid template is what makes a library skimmable instead of a pile of documents that all look different.

## Step 3. Build the master index

One more Doc, at the top level, named **SOP Index**. A single table, one row per SOP, updated by hand as you add each one.

| SOP | Folder | Owner | Last updated |
|---|---|---|---|
| Answering the main phone line | Customer Service | | |
| Booking a lead into the CRM | Sales | | |

This is the front door. Nobody should ever have to browse folders to find something, they search this table or use Google Drive's own search, which already indexes the full text inside every Doc for free.

## Step 4. Add the piece that actually matters, read-tracking

This is the step Trainual charges for and most free SOP setups skip entirely.

1. Create a Google Form named **SOP Acknowledgment**.
2. One question: "Which SOP did you just read?" Dropdown, list every SOP title.
3. A second question: "Your name."
4. In the Form's **Responses** tab, click the Sheets icon to create a linked spreadsheet. Every submission lands there automatically, no code, no automation to build.
5. Put the Form's link at the bottom of the SOP Template itself: "Read this? Confirm here: [link]."

Now every SOP ends with a one-click confirmation, and you have a running, timestamped record in a spreadsheet of who has read what and when, exactly the accountability piece a paid tool would sell you.

## Step 5. Set sharing once, correctly

On the top-level **SOPs** folder, click **Share**, add your team with **Viewer** access unless someone specifically needs to edit. Everything inside a folder inherits its permissions, so this is a one-time setup, not a per-document chore.

---

## Verify it works

- [ ] Every folder contains at least a copy of the template, even if empty
- [ ] The Index table links correctly to every real SOP that exists so far
- [ ] Submitting the Acknowledgment Form adds a row to the linked Sheet within seconds
- [ ] A teammate with Viewer access can read every SOP but cannot accidentally edit one
- [ ] Searching Google Drive for a phrase you know exists inside one SOP actually finds it

---

## What breaks and how to fix it

**Team members editing SOPs who should only be reading them**
Permissions were set per-document instead of on the top-level folder, or someone was added after the folder-level share and inherited the wrong default. Re-share the top folder explicitly as Viewer.

**The Index table goes stale, links point to nothing**
This has no automatic fix, it is a discipline problem, not a technical one. The moment you create a new SOP, add its row to the Index before you do anything else, make it the very last step of writing any SOP, not an afterthought.

**Acknowledgment Form responses are not showing up**
The linked Sheet only captures responses submitted after the link was created, any test submissions from before you clicked the Sheets icon are gone. Not a bug, just the order things happened in.

**Everyone submits the acknowledgment for one SOP but never actually opens it first**
No system, free or $300 a month, can force someone to actually read before confirming. This system gives you the same record a paid tool gives you, no more, no less honest.

**Folder structure already feels wrong after a month**
Reorganize it. Nothing here is precious. A Doc's content survives being moved to a different folder without any broken links, since the Index links to the Doc itself, not to a folder path.

---

## What to do next

Go to **22. Free Thumbnails for Life**. Back to code, a short one.

---

## Sources to verify yourself

- Google Forms and linked Sheets: `https://support.google.com/docs/answer/2917686`
