export type ErrorResponder<ReturnType = unknown> = (error: unknown) => ReturnType;

export const withErrorHandling = async <T>(
  handler: () => Promise<T>,
  onError: ErrorResponder<T>,
): Promise<T> => {
  try {
    return await handler();
  } catch (error) {
    return onError(error);
  }
};

export abstract class BaseRouteCore<HandlerReply> {
  protected async handle(handler: () => Promise<HandlerReply>, onError: ErrorResponder<HandlerReply>) {
    return withErrorHandling(handler, onError);
  }
}

export abstract class BaseEntityRouteCore<TEntity, TDto> {
  protected abstract toDto(entity: TEntity): TDto;

  protected dto(entity: TEntity): TDto {
    return this.toDto(entity);
  }

  protected dtoList(entities: TEntity[]): TDto[] {
    return entities.map((entity) => this.toDto(entity));
  }
}
