# Database Schema Changes

## Overview
This document describes the database schema changes made to rename the `results` table and its `json` column.

## Changes Made

### Table Rename
- **Old Name**: `public.results`
- **New Name**: `public.questionnaire_results`

### Column Rename
- **Old Name**: `json`
- **New Name**: `answers`

## Rationale
The new names provide better clarity and semantic meaning:
- `questionnaire_results` is more descriptive than `results`
- `answers` better describes the content than the generic `json`

## Files Modified

### Database Schema Files
1. **postgres/initdb/000_base.sql**
   - Renamed table from `results` to `questionnaire_results`
   - Renamed column from `json` to `answers`
   - Updated all index names to match new table name

2. **postgres/initdb/001_auth_and_sessions.sql**
   - Updated foreign key constraint name
   - Updated index name for user_id column

### Backend Files
3. **backend/server.js**
   - Updated all SQL queries to use `questionnaire_results` instead of `results`
   - Updated all column references from `json` to `answers`
   - Updated comments to reflect new table name

### Frontend Files
4. **src/redux/results.ts**
   - Updated comment to reference new table name

## Applying Changes (Fresh Start)

To apply these changes with a fresh database:

```bash
# Stop containers and remove all data volumes
docker compose down -v

# Start with new schema
docker compose up --build -d
```

The new schema will be automatically created with the correct table and column names.

## Verification

After starting the application, verify the changes:

```sql
# Connect to the database
docker compose exec postgres psql -U postgres -d postgres

# Check table exists
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'questionnaire_results';

# Check column exists
SELECT column_name FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'questionnaire_results' 
  AND column_name = 'answers';

# Check indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'questionnaire_results';
```

## Impact Assessment

### Breaking Changes
- ✅ **No breaking changes for API consumers** - All API endpoints remain the same
- ✅ **No breaking changes for frontend** - Frontend uses API, not direct database access
- ⚠️ **Database reset required** - All existing data will be lost

### Compatibility
- The application code is fully compatible with the new schema
- All existing functionality remains unchanged
- Fresh start ensures clean schema

## Testing

After applying changes, test the following:
1. ✅ Submit a new survey response
2. ✅ View survey results in the dashboard
3. ✅ Check student mood tracking
4. ✅ View mood history charts

## Support

If you encounter any issues, please:
1. Check the database logs: `docker compose logs postgres`
2. Check the backend logs: `docker compose logs backend`
3. Ensure all containers are running: `docker compose ps`
4. Contact the development team if issues persist
