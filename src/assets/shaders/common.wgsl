struct Objects {
  mat: mat4x4f,
}

struct Uniforms {
  view_mat: mat4x4f,
  proj_mat: mat4x4f,
}

struct PointLight {
  pos: vec3f,
  color_intensity: vec3f,
}

struct PointLights {
  valid_len: u32,
  data: array<PointLight>,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) n: vec4f,
  @location(1) position_v: vec4f,
  @location(2) uv: vec2f,
  @location(3) material_kind: u32,
}

const MATERIAL_LAMBERTIAN: u32 = 0;
