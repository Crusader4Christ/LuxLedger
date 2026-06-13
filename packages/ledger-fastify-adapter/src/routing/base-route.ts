import { withErrorHandling } from '@lux/ledger-http/route-core';
import type { FastifyReply } from 'fastify';
import { sendDomainError } from '../errors/send-domain-error';

export abstract class BaseRoute {
  protected async handle(reply: FastifyReply, handler: () => Promise<unknown>): Promise<unknown> {
    return withErrorHandling(handler, (error) => sendDomainError(reply, error));
  }
}

export abstract class BaseEntityRoute<TEntity, TDto> extends BaseRoute {
  protected abstract toDto(entity: TEntity): TDto;

  protected dto(entity: TEntity): TDto {
    return this.toDto(entity);
  }

  protected dtoList(entities: TEntity[]): TDto[] {
    return entities.map((entity) => this.toDto(entity));
  }
}
