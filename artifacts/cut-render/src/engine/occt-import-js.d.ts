declare module 'occt-import-js' {
  export interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }
  export interface OcctResult {
    success: boolean;
    meshes: OcctMesh[];
  }
  export interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }
  export interface Occt {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
    ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult;
    ReadBrepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  }
  const occtimportjs: (options?: { locateFile?: (path: string) => string }) => Promise<Occt>;
  export default occtimportjs;
}
