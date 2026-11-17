import {
  SubmitAnchorMessageInput,
  SubmitAnchorMessageResult,
  VerifyAnchorMessageInput,
  VerifyAnchorMessageResult,
} from '../types';

export const HCS_PUBLISHER = Symbol('HCS_PUBLISHER');

export interface HcsPublisher {
  submitAnchorMessage(
    input: SubmitAnchorMessageInput,
  ): Promise<SubmitAnchorMessageResult>;

  verifyAnchorMessage(
    input: VerifyAnchorMessageInput,
  ): Promise<VerifyAnchorMessageResult>;
}
