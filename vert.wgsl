@group(0) @binding(0) var<uniform> objects: Objects;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(
  @location(0) position: vec4f,
  @location(1) n: vec4f,
  @location(2) uv: vec2f,
) -> VertexOut {
  let view_mat = uniforms.view_mat * objects.mat;
  let position_v = view_mat * position;

  var output: VertexOut;
  output.position_v = position_v;
  output.position = uniforms.proj_mat * position_v;
  output.n = view_mat * n;
  output.uv = uv;
  output.material_kind = MATERIAL_LAMBERTIAN;
  return output;
}
