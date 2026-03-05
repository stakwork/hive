
Keep code configurable. Remember, types and enums might be changed later!!! So instead of:

```ts
// Find the last message index containing each singleton artifact type
const lastIndexOf: Partial<Record<ArtifactType, number>> = {};
for (let i = messages.length - 1; i >= 0; i--) {
  for (const a of messages[i].artifacts) {
    if ((a.type === ArtifactType.BROWSER || a.type === ArtifactType.PLAN) && !(a.type in lastIndexOf)) {
      lastIndexOf[a.type] = i;
    }
  }
  if (ArtifactType.BROWSER in lastIndexOf && ArtifactType.PLAN in lastIndexOf) break;
}
```

do: 

```ts
// Artifact types where only the last occurrence should be sent
const lastOnlyTypes: ArtifactType[] = [ArtifactType.BROWSER, ArtifactType.PLAN];

// Find the last message index containing each last-only artifact type
const lastIndexOf: Partial<Record<ArtifactType, number>> = {};
for (let i = messages.length - 1; i >= 0; i--) {
  for (const a of messages[i].artifacts) {
    if (lastOnlyTypes.includes(a.type) && !(a.type in lastIndexOf)) {
      lastIndexOf[a.type] = i;
    }
  }
  if (lastOnlyTypes.every((t) => t in lastIndexOf)) break;
}
```

Creating that `lastOnlyTypes` const lets us easily update it later!