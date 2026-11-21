export type Ui = { mount: () => void; remove: () => void; shadowHost: HTMLElement };
type ValueState = {
  signature: string;
  display: string;
  priority: string;
  ui: Ui;
};
export type PopupState = {
  maxHeight: string;
  maxHeightPriority: string;
  minHeight: string;
  minHeightPriority: string;
  desiredWidth: number;
  leftGrip: boolean;
  resizeEdge?: { position: number; leftGrip: boolean; width: number; nativeLeft?: number };
  pinnedRightAt?: number;
  grip?: Ui;
  pending: boolean;
  visible: boolean;
  disposed: boolean;
  values: Map<HTMLElement, ValueState>;
  renders: Map<HTMLElement, { signature: string; timedOut: boolean }>;
  onNavigation: (event: Event) => void;
  outgoingValue?: HTMLElement;
  pendingNavigation?: string;
  contentWasHidden: boolean;
  navigationTimer?: ReturnType<typeof setTimeout>;
};
