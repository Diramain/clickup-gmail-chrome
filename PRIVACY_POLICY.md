# Privacy Policy for ClickUp Gmail Tracker

**Last Updated:** 2026-08-11

## 1. Overview

ClickUp Gmail Tracker is a Chrome extension that helps you create or attach ClickUp tasks from Gmail. The extension runs locally in your browser and does not operate its own servers or analytics service.

This policy describes what the extension handles for version 1.2.0. It does not replace the privacy policies of Google/Gmail, ClickUp, Chrome, or your browser profile provider.

## 2. Gmail Data

The extension reads Gmail data only when you initiate a create or attach action, such as opening the task modal from a Gmail thread or attaching the current email to an existing ClickUp task.

Depending on the action you choose, the extension may use or transfer to ClickUp:

- email subject;
- sender/from value;
- Gmail thread ID;
- Gmail URL for the thread;
- relevant email content used to create task descriptions, comments, or attachments.

When the sanitized HTML attachment option is selected, the extension may upload a sanitized HTML representation of the email as a ClickUp task attachment. In v1.2.0 this checkbox is enabled by default. Original Gmail file attachments are disabled in this version and are not uploaded by the extension.

## 3. ClickUp Data and OAuth

The extension sends requested task, comment, attachment, time-entry, and metadata operations directly to ClickUp through ClickUp APIs. Data sent to ClickUp is controlled by ClickUp after transfer and is subject to ClickUp's own policies and your workspace settings.

OAuth access tokens, refresh tokens, and OAuth configuration are stored locally in the browser profile. The extension encrypts these values using local best-effort encryption before storage where the secure helpers are used. The encryption key also lives in the same browser profile, so this protects primarily against casual at-rest inspection and does not protect a compromised device or browser profile.

## 4. Local Storage

The extension may store locally:

- encrypted best-effort OAuth tokens and OAuth configuration;
- Gmail-thread-to-ClickUp-task mappings and task metadata;
- user settings;
- hierarchy/team/user caches used to reduce repeated API calls;
- sync status metadata such as last local sync time/count.

The email body is not retained as a local mapping. It may be processed temporarily for the action you initiate and may be sent to ClickUp if you create comments/descriptions or keep the sanitized HTML attachment selected.

Mappings persist until you clear local data or uninstall the extension. Caches may expire, be replaced, or be cleared by the user. The extension does not claim automatic time-based purging of mappings.

## 5. Export and Clear Controls

The safe export feature is intended to include mappings, task metadata, and settings. It does not include OAuth tokens, OAuth client configuration, or email HTML.

The clear local data action removes local links and non-auth caches from the extension's browser storage. It does not delete or modify data already sent to ClickUp. To remove tasks, comments, attachments, or other records in ClickUp, manage them in ClickUp.

## 6. No Extension Servers or Analytics

The extension does not send your data to servers operated by the extension author. It does not include extension-operated analytics, tracking pixels, or telemetry services.

Network communication is limited to browser/Gmail/ClickUp behavior needed for the actions you initiate and the extension permissions you grant.

## 7. Your Controls

You can control or remove data by using:

- the extension's safe export control;
- the extension's clear local data control;
- ClickUp OAuth revocation in your ClickUp account/workspace settings;
- browser extension uninstall/removal;
- deletion or modification of tasks, comments, attachments, and other records directly in ClickUp.

## 8. Contact

For questions, contact the author via: https://leandroiramain.com.ar
