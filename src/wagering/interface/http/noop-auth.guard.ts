import { CanActivate, Injectable } from '@nestjs/common';

/**
 * Ponto de extensão de autenticação (README, seção 2): o desafio permite não implementar.
 * Hoje libera tudo. Para integrar um IdP (Keycloak/Zitadel), trocar a implementação
 * por validação do JWT. Os endpoints de health NÃO usam este guard.
 */
@Injectable()
export class NoopAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}