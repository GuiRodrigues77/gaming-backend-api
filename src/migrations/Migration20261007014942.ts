import { Migration } from '@mikro-orm/migrations';

export class Migration20261007014942 extends Migration {

  override name = 'Migration20261007014942';

  override up(): void | Promise<void> {
    this.addSql(`alter table "game_session" add constraint "game_session_user_id_foreign" foreign key ("user_id") references "user" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "game_session" drop constraint "game_session_user_id_foreign";`);
  }

}
