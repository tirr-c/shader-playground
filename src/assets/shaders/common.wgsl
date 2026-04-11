struct Objects {
  mat: mat4x4f,
}

struct Uniforms {
  view_mat: mat4x4f,
  proj_mat: mat4x4f,
}

struct PointLight {
  pos: vec3f,
  dir_and_half_theta: vec4f,
  color_intensity: vec3f,
  view_proj_mat: mat4x4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) n: vec4f,
  @location(1) position_v: vec4f,
  @location(2) uv_or_color: vec4f,
  @location(3) shadow_pos: vec4f,
  @interpolate(flat)
  @location(4) material_kind: u32,
}

const MATERIAL_LAMBERTIAN: u32 = 0;
