# Development Log

## Bug Identification Feature
- **Feature:** Bug identification with DOM source mapping
- **Branch:** feature/bug-identification
- **Started:** 2025-07-25
- **Status:** Core Implementation Complete
- **Last Commit:** f5947a5 - feat: integrate debug coordinates with chat system
- **Summary:** Interactive debug system for Live Preview toolbar that maps UI elements to source code files. Features: (1) Babel plugins inject data-source attributes in dev builds, (2) Debug button activates overlay mode, (3) Click/drag capture sends coordinates to chat, (4) Unified selection handling for both clicks and drags, (5) Auto-disable after interaction. Ready for testing and backend DOM extraction implementation.