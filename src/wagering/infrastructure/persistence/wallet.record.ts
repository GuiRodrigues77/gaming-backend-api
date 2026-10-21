export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string; // numeric(20,2) como string decimal
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}