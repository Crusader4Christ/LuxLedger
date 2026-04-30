import { sendDomainError } from '@api/errors';
import type { FastifyReply } from 'fastify';

export abstract class BaseRoute {
  protected async handle(reply: FastifyReply, handler: () => Promise<unknown>): Promise<unknown> {
    try {
      return await handler();
    } catch (error) {
      return sendDomainError(reply, error);
    }
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
