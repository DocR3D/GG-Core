import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** Answer of the routes that only say the action was done. A failure is an HTTP error, never `ok: false`. */
@ApiSchema({ description: 'Answer of the routes that only say the action was done; a failure is an HTTP error, never `ok: false`' })
export class OkResponseDto {
  /** Always `true` */
  @ApiProperty({ example: true })
  ok!: boolean;
}
