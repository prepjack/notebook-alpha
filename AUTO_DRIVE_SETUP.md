# Auto Drive Folder Fix

## Current migration design

Existing Nodes are migrated in small, resumable batches because Apps Script has a
maximum execution time.

### Recommended one-time migration

1. Deploy the updated `Code.gs`.
2. In Apps Script, run `startDriveFolderMigrationAuto()` once.
3. It processes a small batch and schedules continuation runs every minute.
4. It stops automatically when all existing Nodes have Drive folders.
5. Check Executions for `continueDriveFolderMigration_` runs.

### Manual alternative

Run `migrateExistingNodeFoldersBatch()` repeatedly. Each run advances the saved
cursor and skips folders that already have a valid `drive_folder_id`.

### Reset

Only if you intentionally want to restart the migration cursor:

`resetDriveFolderMigration()`

Do not run the reset during a normal migration.

## New nodes

`saveStructureNode()` continues to create/repair/rename the Drive folder immediately
when a new node is saved.

## Deployment

After replacing Code.gs:

Deploy -> Manage deployments -> Edit -> New version -> Deploy.

The website's existing Apps Script URL can then use the deployed code.
