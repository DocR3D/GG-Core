/** Answer of the routes that only say whether the action was done. */
export class OkResponseDto {
  /** `true` when the action was done, `false` when it had nothing to act on (for example an unknown player) */
  ok!: boolean;
}
