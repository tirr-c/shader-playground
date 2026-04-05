@group(0) @binding(0) var<uniform> objects: Objects;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;
@group(2) @binding(0) var<uniform> point_light: PointLight;

@vertex
fn main(
  @location(0) position: vec4f,
  @location(1) n: vec4f,
  @location(2) uv_or_color: vec4f,
) -> VertexOut {
  let view_mat = uniforms.view_mat * objects.mat;
  let position_v = view_mat * position;

  var output: VertexOut;
  output.position_v = position_v;
  output.position = uniforms.proj_mat * position_v;
  output.n = view_mat * n;
  output.uv_or_color = uv_or_color;
  output.material_kind = MATERIAL_LAMBERTIAN;
  let shadow_pos_raw = point_light.view_proj_mat * objects.mat * position;
  //output.shadow_pos = shadow_pos_raw.xyz / shadow_pos_raw.w;
  output.shadow_pos = shadow_pos_raw;
  return output;
}
