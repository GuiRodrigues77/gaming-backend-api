import { Migration } from '@mikro-orm/migrations';

export class Migration20261007002327 extends Migration {

  override name = 'Migration20261007002327';

  override up(): void | Promise<void> {
    this.addSql(`create table "game" ("id" serial primary key, "name" varchar(255) not null, "genre" varchar(255) not null, "platform" varchar(255) not null);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "game" cascade;`);
  }

}
