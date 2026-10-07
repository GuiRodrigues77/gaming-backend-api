import { Migration } from '@mikro-orm/migrations';

export class Migration20261007015802 extends Migration {

  override name = 'Migration20261007015802';

  override up(): void | Promise<void> {
    this.addSql(`alter table "game_session" add constraint "game_session_game_id_foreign" foreign key ("game_id") references "game" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "game_session" drop constraint "game_session_game_id_foreign";`);
  }

}
