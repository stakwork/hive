// ---------------------------------------------------------------------------
// Mutable boltwall state (reset between tests via resetMockBoltwallState)
// ---------------------------------------------------------------------------
export interface PaidEndpoint {
  id: number;
  route: string;
  method: string;
  status: boolean;
  fee: number;
}

export let mockIsPublic = false;
export let mockEndpoints: PaidEndpoint[] = [
  { id: 1, route: "v2/search", method: "GET", status: true, fee: 10 },
  { id: 2, route: "node/content", method: "POST", status: true, fee: 10 },
];

export function resetMockBoltwallState() {
  mockIsPublic = false;
  mockEndpoints = [
    { id: 1, route: "v2/search", method: "GET", status: true, fee: 10 },
    { id: 2, route: "node/content", method: "POST", status: true, fee: 10 },
  ];
}

export function setMockIsPublic(value: boolean) {
  mockIsPublic = value;
}

export function setMockEndpoints(endpoints: PaidEndpoint[]) {
  mockEndpoints = endpoints;
}
