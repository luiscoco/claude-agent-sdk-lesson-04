# Beacon Notes

Beacon Notes is a TypeScript notes organizer for a course study group. Learners create notes, attach tags, and filter by lesson.

The domain module is separate from the text-based interface. Notes are stored in a local JSON file; concurrent writes are not yet coordinated. It is a small learning fixture, not a hosted service.

Suggested next step: validate incoming note data and make file writes atomic before supporting simultaneous users.
