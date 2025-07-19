```sh

export DATABASE_URL="postgresql://hive_user:hive_password@localhost:5432/hive_db"

psql $DATABASE_URL

\dt

select * from chat_messages;

\d chat_messages

```
