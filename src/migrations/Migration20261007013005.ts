import { Migration } from '@mikro-orm/migrations';

export class Migration20261007013005 extends Migration {

  override name = 'Migration20261007013005';

  override up(): void | Promise<void> {
    this.addSql(`create table "game_session" ("id" serial primary key, "user_id" int not null, "game_id" int not null, "duration_minutes" int not null, "started_at" timestamptz not null);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "game_session" cascade;`);
  }

}
