type SchemaProperties = Readonly<Record<string, unknown>>;

type RequiredPropertyNames<Schema, Properties extends SchemaProperties> = Schema extends {
  readonly required: readonly (infer Name)[];
}
  ? Extract<Name, keyof Properties>
  : never;

type ObjectFromSchema<Schema, Properties extends SchemaProperties> = {
  -readonly [Name in RequiredPropertyNames<Schema, Properties>]-?: InferSchema<Properties[Name]>;
} & {
  -readonly [Name in Exclude<
    keyof Properties,
    RequiredPropertyNames<Schema, Properties>
  >]?: InferSchema<Properties[Name]>;
};

type InferNonNullableSchema<Schema> = Schema extends {
  readonly enum: readonly (infer Value)[];
}
  ? Value
  : Schema extends { readonly type: 'string' }
    ? string
    : Schema extends { readonly type: 'integer' | 'number' }
      ? number
      : Schema extends { readonly type: 'boolean' }
        ? boolean
        : Schema extends { readonly type: 'array'; readonly items: infer Item }
          ? InferSchema<Item>[]
          : Schema extends {
                readonly type: 'object';
                readonly properties: infer Properties extends SchemaProperties;
              }
            ? ObjectFromSchema<Schema, Properties>
            : Schema extends {
                  readonly type: 'object';
                  readonly additionalProperties: true;
                }
              ? Record<string, unknown>
              : unknown;

export type InferSchema<Schema> = Schema extends { readonly nullable: true }
  ? InferNonNullableSchema<Schema> | null
  : InferNonNullableSchema<Schema>;
