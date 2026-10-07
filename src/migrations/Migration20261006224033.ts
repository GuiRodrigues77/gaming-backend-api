import { Migration } from '@mikro-orm/migrations';

export class Migration20261006224033 extends Migration {

  override name = 'Migration20261006224033';

  override up(): void | Promise<void> {
    this.addSql(`create table "user" ("id" serial primary key, "name" varchar(255) not null, "email" varchar(255) not null);`);
    this.addSql(`alter table "user" add constraint "user_email_unique" unique ("email");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "user" cascade;`);
  }

}
